# Portainer CE 2.45.0: Stacks, Compose, Templates, Registries (frontend-driven inventory)

Scope: `app/react/docker/stacks/**`, `app/docker/views/stacks/**`, `app/react/portainer/gitops/**`,
`app/react/portainer/templates/**`, `app/react/portainer/registries/**`, `api/http/handler/stacks/**`.
Kubernetes stacks, container/image/network/volume action inventories, and platform-wide settings are
covered in the sibling notes (03a, 03c) and only touched here where the same component serves Docker stacks.

Classification legend: **core** (single-host single-admin still wants this), **advanced** (useful but
skippable for v1), **enterprise/multi-tenant** (RBAC/teams/multi-environment orchestration, irrelevant to
a single-admin panel), **BE-only** (gated to Portainer Business Edition; either hidden or cosmetically
nagged in CE).

---

## 1. Stack creation methods

All four methods live under one Formik form, gated by a `BoxSelector` "Build method" radio
(`app/react/docker/stacks/CreateView/CreateStackForm/CreateStackInnerForm.tsx:41-49,79-100`). Submission
always funnels through `useCreateStack` (`app/react/common/stacks/queries/useCreateStack/useCreateStack.ts`)
which dispatches to one of 9 typed builder functions (`createSwarmStackFrom*` / `createStandaloneStackFrom*`)
and always POSTs to `/api/stacks/create/{standalone|swarm}/{string|file|repository}`
(`buildCreateUrl`, `app/react/common/stacks/queries/useCreateStack/buildUrl.ts:12-14`; route defined in
`api/http/handler/stacks/handler.go:71-72`). After stack creation the FE separately calls
`applyResourceControl` to set the access-control policy on the returned `ResourceControl`
(`useCreateStack.ts:150-162`).

| Method | Form fields | Component | Validation | Endpoint (method segment) |
|---|---|---|---|---|
| Web editor | Name, CodeMirror YAML textarea (`WebEditorForm`), env vars, access control, webhook toggle | `EditorSection/EditorSection.tsx:24-38` | `getEditorValidationSchema` checks non-empty content + container-name collisions (`EditorSection/validation.ts`) | `string` |
| File upload | Name, single-file picker (`FileUploadForm`) | `UploadSection/UploadSection.tsx:11-22` | `getUploadValidationSchema`, required file + collision check (`UploadSection/validation.ts`) | `file` (multipart/form-data via `json2formData`, `createStandaloneStackFromFile.ts:27-40`) |
| Git repository | `GitForm`: Source selector, ref field, compose path, additional files, auto-update fieldset, relative-path fieldset (BE only) | `GitSection/GitSection.tsx` | `getGitValidationSchema` (`GitSection/validation.ts`), nested in `GitForm`'s own schema | `repository` |
| Custom template | `CustomTemplateSelector`, template note, variables field (BE-gated), read-only/editable YAML preview | `TemplateSection/TemplateSection.tsx` | `getTemplateValidationSchema` (`TemplateSection/validation.ts`) | `string` with `fromAppTemplate: true` |

Shared base fields for every method: stack `name` (uniqueness checked client-side against existing
stacks and Docker containers/services, `useValidationSchema.ts` + `NameField.tsx`), `env` (env var list),
`accessControl`, `enableWebhook`, and a `registries: Array<RegistryId>` field that is always initialized
to `[]` and has **no visible UI control anywhere in the create form** (see section 8: registries are
resolved at the environment level, not picked per-stack at creation time despite the payload plumbing
existing end-to-end, `CreateStackForm.tsx:57-58,120-121`). **core**.

The Web editor / Upload / Template methods are also reachable from the stack-list "+ Add stack" button
and the legacy AngularJS route registrations in `app/docker/react/views/stacks.ts` (component
registration only; routing itself lives in `app/docker/__module.js`). `CreateStackForm.tsx:29-31`
also supports pre-filling the editor from a `yaml` query/state param (used when "Create template from
stack" or "duplicate" navigates into the create view).

---

## 2. Stack lifecycle actions

All actions render in `StackActions.tsx` (`app/react/docker/stacks/ItemView/StackInfoTab/StackActions.tsx`),
gated per-button by `Authorized authorizations="PortainerStack*"`. **core** throughout except duplication/migration.

| Action | Trigger | Confirmation | Backend | Effect on containers |
|---|---|---|---|---|
| Start | `StackActions.tsx:75-89` (`Stack.Status === Inactive`) | none | `POST /stacks/{id}/start` (`stack_start.go`) | Starts previously-stopped containers/services for the stack |
| Stop | `StackActions.tsx:66-74,160-181` | `confirm()` Warn modal, "Are you sure you want to stop this stack?" | `POST /stacks/{id}/stop` (`stack_stop.go`) | Stops (does not remove) containers |
| Delete | `StackActions.tsx:92-101,204-228` | `confirmDelete('...Associated services will be removed as well')` | `DELETE /stacks/{id}` (`stack_delete.go`) | Removes the stack's containers/services; optional `external` flag lets an out-of-band `docker compose` stack be removed the same way |
| Update / redeploy | `StackEditorTab` submit button | `confirmStackUpdate` (SwitchPrompt: "Re-pull image and redeploy", default = swarm) | `PUT /stacks/{id}` (`stack_update.go`) | Rewrites compose file on disk, redeploys; `Prune` toggle removes orphaned services; `RepullImageAndRedeploy` forces a fresh image pull |
| Git pull-now / redeploy | `GitPullButton.tsx` (only rendered for git-backed, non-app-template stacks) | `confirmStackUpdate('Pulling from git will override any local changes...')` | `useUpdateGitStack` -> `PUT /stacks/{id}/git/redeploy` (`stack_update_git_redeploy.go`) | Force-pulls the repo, redeploys |
| Detach from Git | `StackActions.tsx:126-142,231-254` | `confirm()` Warn, "Do you want to detach the stack from Git?" | `useUpdateStackMutation` -> `PUT /stacks/{id}` with current file content and `prune:false` | Converts the stack to a plain (non-git) web-editor stack; no container impact |
| Associate (orphan adoption) | `AssociateStackForm.tsx` shown only on orphaned stacks | none beyond access-control validation | `useAssociateStackToEnvironmentMutation` -> `PUT /stacks/{id}/associate` (`stack_associate.go`, admin-only) | Re-attaches a stack whose original endpoint was deleted to the current environment |
| Create template from stack | `StackActions.tsx:104-119` (only when `isRegular && fileContent`) | none | Navigates to `docker.templates.custom.new` with `fileContent` prefilled | none (authoring action) |
| Duplicate / Migrate / Rename | `StackDuplicationForm/StackDuplicationFormInner.tsx` | none beyond validation | `useDuplicateStackMutation` / `useMigrateStackMutation` | Migrate moves the stack to another environment (or renames in place if same env); Duplicate deploys a copy. **advanced** (multi-environment convenience, low value on a single host) |

Backend route list confirming the full surface: `api/http/handler/stacks/handler.go:71-93` (`create`,
`list`, `inspect`, `delete`, `associate`, `name/{name}` delete for k8s, `update`, `git`, `git/redeploy`,
`file`, `migrate`, `start`, `stop`, `webhooks/{webhookID}`).

---

## 3. Environment variable handling

Shared component: `app/react/components/form-components/EnvironmentVariablesFieldset/*`, wrapped for
stacks by `StackEnvironmentVariablesPanel.tsx` which adds stack-specific help copy about `stack.env`
files (auto-created for editor/upload/template methods, must pre-exist in the repo for git deploys;
`StackEnvironmentVariablesPanel.tsx:24-63`). **core**.

- **Dual mode**: `EnvironmentVariablesFieldset.tsx:13-42` toggles between `SimpleMode` (key/value row list,
  add/remove, optional `canUndoDelete` soft-delete) and `AdvancedMode` (single CodeMirror textarea).
  Mode is local `useState`, not persisted.
- **Advanced mode / .env paste**: `AdvancedMode.tsx` renders values as `key=value` lines
  (`convertToArrayOfStrings`) and re-parses on every edit via `parseDotEnvFile` (`utils.ts`), so pasting
  the contents of an existing `.env` file directly populates the row list when the user switches back to
  Simple mode.
- **Reaching compose**: the resulting `Array<{name, value}>` (`Values` in `types.ts`) is sent as `Env` /
  `env` in every create/update payload (`CreateStackForm.tsx:114`, `useUpdateStack.ts:17`,
  `StackEditorTab.tsx:79`). Server-side, `updateComposeStackPayload.Env []portainer.Pair`
  (`stack_update.go:29-31`) is substituted into the compose file as environment values by the compose
  deployment config builder; it is not literally interpolated as shell `$VAR` refs unless the compose
  file itself references them, matching standard `docker compose --env-file` semantics.
- Validation: `envVarValidation()` enforces required names and uniqueness across the list
  (`EnvironmentVariablesFieldset.tsx:44-58`).

---

## 4. Git integration

Git integration was refactored in this version around a first-class, reusable **Source** object
(`app/react/portainer/gitops/sources/**`, routes `portainer.gitops.sources*` in
`app/portainer/__module.js:328-372`) rather than embedding raw repo URL/credentials on every stack.
**core** for the basic repo+ref+path+webhook flow; the Source/Workflow management screens and several
individual fields are BE-gated or better classified as advanced.

| Concern | Component | Notes | Classification |
|---|---|---|---|
| Repository reference selection | `GitSourceSelector.tsx` (picks a `Source`) + `RefField/RefField.tsx` | CE: plain text `Input` for the ref (placeholder `refs/heads/main`, defaults to HEAD if blank); BE: `RefSelector` dropdown fetching branches/tags live, and the ref becomes *required* (`refFieldValidation`, `RefField.tsx:57-64`) | core (CE variant) |
| Compose file path | `ComposePathField.tsx:56-79` | CE: plain text `Input`; BE: `PathSelector` (repo file-tree browser) | core (CE variant), browser is BE-only |
| Additional files | `AdditionalFileField` inside `GitForm.tsx:85-92` | list of extra file paths pulled from the same repo alongside the compose file | core |
| Authentication | Delegated to the selected `Source` (`GitSourceSelector`); sources carry their own username/password/PAT/SSH auth (`sources/components/ProviderCredentialFields.tsx`, `GitAuthentication.tsx`) | Auth is configured once per Source and reused, not re-entered per stack | core |
| Auto-update polling interval | `Source.Interval`, set on the **Source**, not the stack, via `IntervalField` in Source create/edit forms (`sources/components/IntervalField.tsx`, `sources/CreateView/steps/ConfigureGit.tsx:62-67`, `sources/ItemView/SettingsTab/EditForm/EditPollingWidget.tsx`). Polling itself runs server-side via `api/gitops/scheduling/scheduler.go` (`SourceScheduler.reconcileSource` schedules a repeating job per Source). The stack-level `AutoUpdateModel.Interval` field is explicitly `@deprecated` and never read/written by the UI (`AutoUpdateFieldset/utils.ts:4-8`) | core, but architecturally heavier than "one field per stack" |
| Webhook redeploy | `AutoUpdateFieldset.tsx:12-35` "Create a Webhook" switch reveals `AutoUpdateSettings` (`WebhookSettings`, `ForcePullImage` switch tagged `FeatureId.STACK_PULL_IMAGE`, `ForceDeploymentSwitch`). Invocation: `POST /stacks/webhooks/{webhookID}` (public access, `handler.go:91-92`, backed by `api/http/handler/webhooks`) | Fully functional in CE; `STACK_PULL_IMAGE` badge is cosmetic only (`SwitchField` `featureId` prop just shows a tooltip badge, never disables, `SwitchField.tsx:44-66`) | core (BE badge is cosmetic) |
| `force redeployment` | `ForceDeploymentSwitch.tsx` tagged `FeatureId.FORCE_REDEPLOYMENT` | **Actually gated**: `FORCE_REDEPLOYMENT: Edition.BE` in the feature map (`feature-flags.service.ts`), and unlike `STACK_WEBHOOK`/`STACK_PULL_IMAGE`, `SwitchField.disabled` is not separately set to false here, so effectively the toggle is rendered but drives `RepositoryAutomaticUpdatesForce` which the CE deploy path still honors server-side (no backend edition check found in `stack_update_git_redeploy.go`) - treat this as **BE-only from a UI-affordance standpoint but not backend-enforced** | BE-only (soft; UI badge only, functionally works if toggled) |
| Manual pull-now | `GitPullButton.tsx` | One-off "Pull and redeploy" button, confirms via `confirmStackUpdate` | core |
| Edit git settings post-creation | `EditGitSettingsModal.tsx` | Lets a user change ref/path/auto-update/env for an existing git stack without a full redeploy dialog; offers a "redeploy now" checkbox that reuses `confirmStackUpdate` | core |
| Detach from Git | see section 2 | core |
| Sources & Workflows management UI | `app/react/portainer/gitops/sources/**`, `app/react/portainer/gitops/workflows/**` | Full CRUD screens, connection testing, access control per source, cross-cutting "workflow" concept linking a Source to many deployed stacks/edge stacks | advanced (single-host doesn't need multi-source reuse or the workflow abstraction; a simple per-stack git config field set is sufficient) |
| Relative-path volume support | `GitSection.tsx:39-41`, `StackRelativePathFieldset.tsx` | Entire fieldset only rendered `isBE` | BE-only |

---

## 5. Stack file versioning and rollback

**This is the most important gotcha in the whole subsystem for CE**: the UI exposes a version selector
that is effectively a no-op for standalone/swarm Docker stacks.

- Frontend `Stack` type carries `StackFileVersion: number` and `PreviousDeploymentInfo?: StackDeploymentInfo`
  (`app/react/common/stacks/types.ts:74,90-91`). `StackEditorTab.tsx:38-41` builds
  `versions = compact([stack.StackFileVersion, stack.PreviousDeploymentInfo?.FileVersion])` (at most 2
  entries) and passes them to `StackVersionSelector` inside the CodeMirror toolbar
  (`app/react/components/StackVersionSelector/StackVersionSelector.tsx`, rendered from
  `CodeEditor.tsx:120-134`).
- Selecting an older version calls `useVersionedStackFile` (`useVersionedStackFile.tsx`), which GETs
  `/stacks/{id}/file?version=N` and replaces the editor content, and sets the editor to `readonly` while
  a rollback version is selected (`CodeEditor.tsx:88-95` `isRollback` state).
- On submit, `StackEditorTab.tsx:79-89` sends `rollbackTo: values.rollbackTo` as part of the `PUT /stacks/{id}`
  payload (`useUpdateStack.ts:17-27`).
- **The Go backend does not implement any of this for Docker stacks.** `stack_file.go:41-133` reads
  `handler.FileService.GetFileContent(stack.ProjectPath, stack.EntryPoint)` unconditionally, ignoring
  any `version` query parameter entirely. `updateComposeStackPayload` / `updateSwarmStackPayload`
  (`stack_update.go:28-63`) have no `RollbackTo` field at all, so a `rollbackTo` value sent by the FE is
  silently dropped by Go's JSON decoder. The only field named `RollbackTo` in the whole codebase is
  explicitly commented `// EE only feature` on the **edge stack** deployment status type
  (`api/portainer.go:442-444`), a different subsystem (edge agent execution, not Docker stacks).
- What *does* exist server-side for Docker stacks is a single-level automatic backup/rollback used only
  for failure recovery during a deploy: `FileService.UpdateStoreStackFileFromBytes` creates one `.bak`
  copy before overwriting, `RollbackStackFile` restores it if the deploy errors, and
  `RemoveStackFileBackup` clears it on success (`stack_update.go:280-322`,
  `api/filesystem/filesystem.go:276-370`). There are separate `*ByVersion` filesystem methods
  (`UpdateStoreStackFileFromBytesByVersion`, `RollbackStackFileByVersion`,
  `RemoveStackFileBackupByVersion`, `filesystem.go:295-380`) that implement real per-version storage, but
  grepping the stacks handler package shows they are not called from any Docker stack endpoint - they
  back Edge stack deployments.
- **Net effect**: in CE, "rollback" for a Docker/Compose stack is really just "the browser cached the
  previous file content" (2 entries max, lost on refresh) with a save button that the server accepts but
  functionally ignores; there is no true multi-version history, and no diff view is offered for stacks at
  all (`DiffViewer` component exists but is only wired into the Kubernetes/Helm manifest-preview flow,
  `app/react/kubernetes/helm/HelmApplicationView/ReleaseDetails/DiffViewSection.tsx`,
  `app/react/kubernetes/**/ManifestPreviewFormSection.tsx`; nothing under `app/react/docker/stacks/**`
  references `DiffViewer`).
- Classification: **core-looking but non-functional in CE for Docker stacks** - Docknight should not
  bother replicating the version-selector UI as-is; a real implementation (store N previous compose files,
  diff, restore) would need to be built from scratch, not ported.

---

## 6. The editor: CodeMirror, YAML linting, diff view, discard guard

- **Stack**: `@uiw/react-codemirror` + `@uiw/codemirror-themes` (`app/react/components/CodeEditor/CodeEditor.tsx:1-3`),
  `@codemirror/legacy-modes` for Dockerfile/shell, `yaml-schema` package (`yamlCompletion`, `yamlSchema`)
  for YAML, `react-codemirror-merge` (`CodeMirrorMerge`) for the diff view.
- **YAML setup** (`useCodeEditorExtensions.ts:38-68`): `yamlSchema(schema)` returns `[yaml, linter, ...,
  stateExtensions]`; a custom `yamlIndentExtension` auto-indents 2 spaces after a trailing `:`;
  `lineNumbers()` explicitly set so gutters align between the plain editor and the diff view;
  `lintGutter()` and `autocompletion()` (debounced 300ms, icons off) are only enabled **when a JSON
  Schema is supplied** - stacks pass the live Docker Compose JSON Schema fetched by
  `useDockerComposeSchema` (referenced from `CreateStackInnerForm.tsx:8,52-55`, schema query itself not
  in the file map but wired the same way in `StackEditorTab.tsx:47,116` and `TemplateSection.tsx`).
- **Special-char highlighting**: `extendedHighlightSpecialChars` extends CodeMirror's built-in special-char
  highlighter to also flag invisible unicode (NBSP, ZWJ, word joiner, narrow NBSP) that's otherwise
  invisible when pasted into a compose file (`useCodeEditorExtensions.ts:20-25`).
- **Diff view**: `DiffViewer.tsx` wraps `CodeMirrorMerge` with `Original`/`Modified` read-only panes,
  `collapseUnchanged` (margin 10, minSize 10) to fold unchanged regions, and optional file-name header
  bars with copy buttons. As noted in section 5, this component is **not used anywhere in the Docker
  stacks flow** in this codebase snapshot - only Kubernetes/Helm manifest previews use it. If Docknight
  wants a real diff-on-redeploy experience it needs to be newly wired to the compose editor, reusing this
  existing component.
- **`confirmWebEditorDiscard` guard**: `WebEditorForm.tsx:71-82` exports `usePreventExit(initialValue,
  value, check)`, which does a whitespace-insensitive compare (`cleanText` strips all newlines) and, if
  content changed, registers `usePreventFormExit(() => isChanged, check, confirmWebEditorDiscard)`
  (`usePreventFormExit` intercepts uirouter transitions/browser unload). `confirmWebEditorDiscard`
  (`app/react/components/modals/confirm.ts:42-49`) is a plain Warn modal: "You currently have unsaved
  changes in the editor. Are you sure you want to leave?" This hook is reused verbatim by the stack create
  editor, stack create template section, the stack editor tab, the edge-stack non-git form, and both
  custom-template create/edit forms - i.e. it is the one generic "leaving with unsaved YAML" guard across
  the whole app. **core** pattern to replicate.

---

## 7. Templates: app templates vs custom templates

Two entirely separate systems sharing only UI conventions. **core** for both, with the variable
substitution UX specifically **BE-only** in the variant that matters for reusable parametrized templates.

### App templates (`app/react/portainer/templates/app-templates/**`)
- Read-only catalog of predefined stacks/containers, sourced from a **remote JSON manifest URL**
  configurable in settings (`Settings.TemplatesURL`, falling back to `portainer.DefaultTemplatesURL` if
  unset, `api/http/handler/templates/utils_fetch_templates.go:18-27`). Fetched via `GET /templates`
  (`template_list.go`), no auth beyond `AuthenticatedAccess`.
- Frontend `useAppTemplates` (`app-templates/queries/useAppTemplates.ts:20-42,63-76`) cross-references
  each template's declared `registry` URL against the caller's available registries
  (`useEnvironmentRegistries` when an environment is known, else the global `useRegistries`), defaulting
  to a synthetic `DockerHubViewModel` when unset - i.e. app templates always resolve to a concrete
  registry at render time.
- Deploy path: `DeployFormWidget/StackDeployForm/StackDeployForm.tsx` builds a stack-create payload the
  same way as the manual "Web editor" method; template file content itself comes from
  `POST /templates/{id}/file` (`template_file.go`).
- No git-backing, no versioning, no variable substitution UI beyond Docker/container env var fields
  already covered in section 3 (`app-templates/DeployFormWidget/EnvVarsFieldset.tsx`).

### Custom templates (`app/react/portainer/custom-templates/**`, list/create/edit under `app/react/portainer/templates/custom-templates/**`)
- User-authored, stored server-side (own `ProjectPath`/`EntryPoint` on disk, same `FileService` pattern
  as stacks), optionally git-backed (`CustomTemplate.GitConfig`).
- Can be created from scratch (editor/upload) or "from an existing stack" (`docker.templates.custom.new`
  with `fileContent` prefilled, see section 2).
- Consumed for stack creation via `TemplateSection.tsx` (section 1): `CustomTemplateSelector` picks a
  template, `useCustomTemplateFile` fetches its content, and if git-backed the preview editor is rendered
  `readonly` (git-backed custom templates can't be hand-edited at deploy time,
  `TemplateSection.tsx:118-119`).
- **Variable substitution model**: Mustache-style `{{ variable_name }}` placeholders. Parsing/rendering
  utilities live in `app/react/portainer/custom-templates/components/utils.ts`:
  - `getTemplateVariables(templateStr)` uses `Mustache.parse` to extract `{{ name }}` spans.
  - `renderTemplate(template, variables, definitions)` builds a substitution map (explicit value, else the
    variable definition's `defaultValue`, else falls back to re-emitting the raw `{{ name }}` token) and
    calls `Mustache.render` with escaping disabled (`escape: (t) => t`, so values are inserted verbatim,
    not HTML-escaped - correct for YAML).
  - Author-side, `CustomTemplatesVariablesDefinitionField` lets the template creator declare
    name/label/default/description per variable.
  - Deploy-side, `CustomTemplatesVariablesField` renders one input per declared variable and live-reruns
    `renderTemplate` into the preview editor on every keystroke (`TemplateSection.tsx:65-79`).
  - **`export const isTemplateVariablesEnabled = isBE;`** (`utils.ts:9`) - the entire deploy-time variable
    substitution form is gated behind Business Edition (`TemplateSection.tsx:114-121`:
    `{isTemplateVariablesEnabled && <CustomTemplatesVariablesField .../>}`). In CE this section is not
    rendered at all (no badge, just absent), meaning a CE user deploying a custom template containing
    `{{ variable }}` placeholders must manually find-and-replace them by hand-editing the YAML preview
    before deploying. **BE-only.**

---

## 8. Registries

Type surface: `app/react/portainer/registries/types/registry.ts:8-19,60-75`. Supported `RegistryTypes`
(CE, all creatable): `ANONYMOUS`, `QUAY`, `AZURE`, `CUSTOM`, `GITLAB`, `PROGET`, `DOCKERHUB`, `ECR`,
`GITHUB` (`registry.ts:8-18`; create-flow tiles for all but `ANONYMOUS`/`GITHUB` in
`CreateView/options.tsx:6-53`). **core** (registry CRUD + credential storage is genuinely useful even
single-host; the CE-vs-BE line is drawn at *browsing* registry contents, not at *using* them for pulls).

- **Credential storage**: registry documents hold `Authentication: boolean`, `Username`, and a
  server-side-only `Password` (never round-tripped back to the client after creation), plus per-type
  metadata (`Gitlab`, `Quay`, `Github`, `Ecr` sub-objects) and an optional
  `ManagementConfiguration` block (type/auth/AccessToken for registry-management features). Storage and
  CRUD routes: `app/portainer/registry-management/index.js` (admin-only AngularJS routes proxying to the
  Go registries handler, not in the read file map for this note but referenced by the file map summary).
- **How a pull picks a registry**:
  - Ad-hoc image pull: `RegistrySelectPrompt.tsx` (`app/react/docker/images/ItemView/RegistrySelectPrompt.tsx`)
    is an explicit modal picker used when an image's registry can't be inferred, listing all registries
    visible to the current environment.
  - Programmatic pulls (e.g. `usePullImageMutation.ts:21-33,63-83`) resolve a `Registry` object by ID and
    call `withRegistryAuthHeader(registry?.Id)` to attach the `X-Registry-Auth` header understood by the
    Docker Engine API proxy; if no registry is given, the pull is anonymous/Docker Hub.
  - Stack/image builds and template deploys do **not** offer a per-action registry picker; instead,
    registries are associated at the **environment** level (`useEnvironmentRegistries`) and the Docker
    Engine daemon on that host already has any configured registry credentials available transparently
    when pulling images referenced in a compose file - i.e. for compose stacks specifically there is no
    Portainer-mediated per-pull auth injection; Docker Engine's own credential store on the host handles
    it. The `registries: Array<RegistryId>` field plumbed through the stack-create payload
    (section 1) exists in the type system end-to-end but has no UI control, so it is always `[]` in
    practice from the create form.
- **CE hard limit**: `RegistriesDatatable/columns/actions.tsx` - the repository "Browse" action (browsing
  a registry's image catalog / tags in-app) is **hard-disabled in CE**, gated by
  `FeatureId.REGISTRY_MANAGEMENT` which is `Edition.BE` in the feature map. This is a genuine functional
  gate (button disabled), not cosmetic. **BE-only**.
- The `ListView/RegistriesDatatable/columns/DefaultRegistryDomain.tsx` / `DefaultRegistryName.tsx` /
  `DefaultRegistryAction.tsx` trio implements "set as default Docker Hub registry" (to attach
  authenticated Docker Hub pull credentials globally, avoiding the anonymous rate limit) - **core**, cheap
  and high value for a single host that hits Docker Hub pull limits.

### Image build and pull (from the frontend, briefly - out of core scope but named in the target)
- **Pull**: `usePullImageMutation.ts` POSTs to the raw Docker Engine proxy
  (`buildDockerProxyUrl(env, 'images', 'create')` with `fromImage=<image:tag>`), registry auth via header
  as above. UI: `PullImageFormWidget.Form.tsx` (name/tag fields + optional agent-node selector for Swarm).
- **Build**: `useBuildImageMutation.ts` is a thin, well-documented wrapper around the raw Docker Engine
  `/build` endpoint (`buildDockerProxyUrl(env, 'build')`), supporting four content shapes (upload a
  Dockerfile, remote git/tarball URL, inline Dockerfile content, inline content + extra files) and passes
  through the full native Docker build query-parameter surface (buildargs, cache-from, target stage,
  platform, BuildKit `outputs`, etc. - `useBuildImageMutation.ts:130-260`). No Portainer-specific build
  logic; it is a direct proxy. **core** as a thin proxy pass-through, but genuinely low priority versus
  compose-native builds (`docker compose build`, which the compose deploy path already supports via
  `pull_policy: build` per `ComposePathField.tsx:52-58`).

---

## 9. Classification summary and Docknight MVP read

| Feature | Classification | Docknight MVP verdict |
|---|---|---|
| Stack create: web editor | core | **Build.** Primary flow. |
| Stack create: file upload | core | **Build.** Cheap, complements editor. |
| Stack create: git repository (basic: URL/ref/path/creds, no Source abstraction) | core | **Build**, but flatten to per-stack fields; skip the reusable-Source layer. |
| Stack create: custom template | core | Build if Docknight wants a template gallery; otherwise skip for v1. |
| Stack create: app templates (remote catalog) | advanced | Skip for v1 (requires hosting/consuming a remote manifest); revisit only if users want a curated gallery. |
| Start / stop / delete / redeploy | core | **Build**, this is the whole point of the app. |
| Pull-image-and-redeploy toggle | core | **Build.** |
| Prune-on-redeploy toggle | core | **Build**, cheap Compose flag passthrough. |
| Detach from Git | advanced | Build later if git-backed stacks are supported. |
| Duplicate / Migrate / Rename stack | advanced | Skip; single host has nowhere to migrate to. |
| Orphan-stack re-association | enterprise/multi-tenant | Skip; only matters when environments can be deleted/re-added. |
| Env var dual-mode editor (simple/advanced) + .env paste | core | **Build**, high UX value, cheap. |
| Git ref/path/auth (plain-text CE variant) | core | **Build.** |
| Git polling interval | core (but simplify) | Build as a plain per-stack interval field; skip the Source/Workflow abstraction entirely. |
| Git webhook redeploy | core | **Build.** Genuinely useful automation, works fully in CE already. |
| `force redeployment` on webhook/poll | BE-only (soft) | Build if desired; nothing backend-side stops it, it's just BE-badged upstream. |
| Git Source/Workflow management UI | advanced | Skip; single-host doesn't need reusable multi-target git sources. |
| Relative-path volume support | BE-only | Skip. |
| Stack file "versioning"/rollback (as shipped in CE) | core-looking, actually broken | **Do not port as-is.** If wanted, build real version history from scratch (store N previous compose files + real restore, wire the existing `DiffViewer`). |
| CodeMirror YAML editor + lint + autocomplete against Compose JSON Schema | core | **Build.** High leverage, and the schema-driven approach is exactly right for a Material 3 mobile-friendly editor. |
| Diff viewer (`CodeMirrorMerge`) | core (as a component) | **Build**, and actually wire it to stack redeploy (Portainer itself doesn't, ironically) since it is the natural "review before redeploy" UX for a single-admin tool. |
| `confirmWebEditorDiscard`-style unsaved-changes guard | core | **Build**, generic pattern, applies to every text-editing surface. |
| Custom templates (author + deploy) | core | Build if templating is wanted; keep the deploy-time variable substitution (Mustache) rather than mimicking CE's BE gate - it's cheap (a small library) and clearly valuable. |
| Custom template variable substitution UI | BE-only in CE, but cheap to build | **Build it anyway** - CE only hides it for licensing reasons, not technical ones; the rendering logic (`Mustache.render` with `escape` disabled) is trivial to replicate. |
| Registry CRUD + credential storage (Docker Hub, ECR, Quay, GitLab, ProGet, Azure, custom) | core | **Build a reduced version**: Docker Hub authenticated + generic custom registry (user/pass/URL) covers the overwhelming majority of self-hosted use; skip cloud-specific IAM flows (ECR/Azure/GCR-style) unless requested. |
| Registry repository "Browse" (catalog/tag browsing) | BE-only | Skip for v1; nice-to-have later, not core to deploying stacks. |
| Default-registry-for-Docker-Hub convenience | core | **Build**, trivial and solves real Docker Hub rate-limit pain. |
| Per-stack registry picker | vestigial (dead in CE upstream) | Skip; rely on host-level Docker credential store, same as upstream effectively does. |
| Image build (raw Docker Engine `/build` proxy) | core (thin) | Low priority; `docker compose build` already covers the common Compose case. Only build a dedicated UI if ad-hoc single-image builds are a real user need. |
| Image pull (raw Docker Engine `/images/create` proxy) | core (thin) | **Build** minimal version, needed to support "pull before deploy" UX regardless. |

**Overall read for Docknight**: the stack/Compose creation, lifecycle, env-var, and editor primitives are
squarely core and should be built close to Portainer's shape (they're already well-designed for a
Compose-centric single-host tool). The git integration should be built *simpler* than upstream (skip the
Source/Workflow reuse layer, which exists for multi-tenant/multi-environment BE scenarios). Skip
versioning/rollback as shipped (it's non-functional in CE) and skip the app-template remote-catalog and
registry-browsing features as non-essential. The one clear "free win" is custom-template variable
substitution: CE hides a fully-implemented, trivial feature behind a license flag, so Docknight can ship
it without the upstream gate and get feature parity with BE for near-zero engineering cost.
