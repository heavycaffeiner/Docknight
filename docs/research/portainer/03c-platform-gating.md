# Portainer CE 2.45.0: Platform Features, RBAC, and BE Gating

Scope: platform-level features (users, teams, settings, account, logs, notifications), CE RBAC model, the Business Edition (BE) gating mechanism end to end, and a distilled MVP recommendation for Docknight. Docker resource actions and the stack/Compose subsystem are covered by sibling notes (`03a-routes-resources.md`, `03b-stacks-compose.md`); this note references their topic names only.

All paths are relative to `.ref/portainer/`.

## 1. Platform feature table

| Feature | Purpose | Route / entry point | Classification |
|---|---|---|---|
| Users list/create/delete | Manage local Portainer accounts | `portainer.users` (`app/portainer/__module.js:180-195`), `app/react/portainer/users/ListView/ListView.tsx` | core |
| User role (Admin / Standard / EdgeAdmin) | Coarse global privilege level | `Role` enum, `app/portainer/users/types.ts:9-13` | core |
| Team leader on user creation | Delegate limited user-management to a non-admin | `NewUserForm/TeamsFieldset.tsx` (`AdminSwitch`, `isPureAdmin`) | advanced |
| Teams CRUD | Group users for access control assignment | `portainer.teams` (registered by `app/react/users/teams`), `app/react/portainer/users/teams/ListView/ListView.tsx` | core |
| Team membership (member/leader) | Assign per-team role | `app/react/portainer/users/teams/queries/useUpdateRoleMutation.ts` | core (leader assignment is CE; see FeatureId.TEAM_MEMBERSHIP note in 3.) |
| RBAC "Roles" list | Enumerates environment-access roles | `portainer.roles`, `app/react/portainer/users/RolesView/RbacRolesDatatable.tsx` | BE-only (only "Standard user" is usable in CE, see section 2) |
| Effective Access Viewer | Shows what a given user can access across environments | `app/react/portainer/users/RolesView/AccessViewer/EffectiveAccessViewer.tsx`, gated by `isLimitedToBE('rbac-roles')` (`access-viewer.controller.js:36-38`) | BE-only |
| Access control on resources (containers, volumes, networks, stacks, custom templates, etc.) | Public / Private / Restricted(users+teams) / Administrators-only ownership per resource | `app/react/portainer/access-control/**`, `ResourceControlOwnership` enum (`types.ts:16-21`) | core |
| Registries (Docker Hub, custom, ECR, Quay, Gitlab, ProGet, Azure, Anonymous) | Store credentials for private image pulls | `app/portainer/registry-management/index.js` (admin-only CRUD), `app/react/portainer/registries/**` | core (CRUD); registry repository **Browse** is BE-only (section 3) |
| Settings: Application | Snapshot interval, logo, login banner, templates URL, edge checkin default | `portainer.settings`, `ApplicationSettingsPanel.tsx` | core |
| Settings: Authentication | Internal / LDAP / OAuth / AD method selection, password policy, session lifetime | `portainer.settings.authentication`, `app/react/portainer/settings/AuthenticationView/**` | core (Internal, custom LDAP, OAuth) / BE-only (AD, pre-baked OpenLDAP, hide-internal-auth) |
| Settings: Edge Compute | Enable/disable edge features, edge URL, tunnel address, enforce Edge ID | `portainer.settings.edgeCompute`, `EdgeComputeSettings.tsx` | advanced (edge is out of scope for a single host) |
| Settings: Backup | Download a config backup file locally, or schedule to S3 | `BackupSettingsView/BackupSettingsPanel.tsx` | core (local file) / BE-only (S3 schedule) |
| Settings: Hidden containers | Hide containers matching a label from the UI | `HiddenContainersPanel/HiddenContainersPanel.tsx` | advanced |
| Settings: SSL / Helm cert / Kube settings | TLS cert upload, Helm registry config, Kubernetes-only deployment options | `SSLSettingsPanel.tsx`, `HelmCertPanel.tsx`, `KubeSettingsPanel/**` | BE-only or Kubernetes-only (out of scope) |
| Settings: Experimental features | BE-only feature flag toggles | `ExperimentalFeatures/ExperimentalFeaturesForm.tsx`, rendered only `if (isBE)` (`SettingsView.tsx:44`) | BE-only |
| Host/environment security settings | Per-environment toggles for what regular (non-admin) users may do: host management, volume browser, bind mounts, privileged mode, host namespace, stack management, device mapping, container capabilities, sysctl, security-opt; plus GPU config | `app/docker/views/docker-features-configuration/docker-features-configuration.controller.js:16-26,110-124` | core |
| Account: profile / password / theme | Self-service password change, UI theme, front-end data caching toggle | `app/react/portainer/account/AccountView/**` | core |
| API keys / access tokens | Personal bearer tokens for API access | `portainer.account.new-access-token` (`__module.js:120-128`), `app/react/portainer/account/CreateAccessTokenView/**`, `AccessTokensDatatable/**` | core |
| Git credentials / Helm repositories (account) | Store personal git creds and Helm repo URLs | `app/react/portainer/account/git-credentials/**`, `helm-repositories/**` | advanced / Kubernetes-only |
| Authentication logs | Login/logout audit trail (7-day retention) | `portainer.authLogs`, `auth-logs-view.controller.js` | BE-only in practice: page always renders `logs: []` hardcoded stub and is wrapped in a `limited-be` overlay (section 3) |
| Activity (audit) logs | Full audit trail of user actions (what was created/deleted/edited) | `portainer.activityLogs`, `app/react/portainer/logs/ActivityLogsView/ActivityLogsView.tsx:47-48` | BE-only |
| Notifications | In-browser toast notification history (client-side only, not persisted server-side) | `portainer.notifications`, `app/react/portainer/notifications/NotificationsView.tsx` | core (trivial) |
| Environments / Groups / Tags | Register and organize Docker/Kubernetes/Edge endpoints | `portainer.endpoints`, `portainer.groups`, `portainer.tags` | core (single "environment" for Docknight; groups/tags are multi-host constructs) |
| Edge Compute (agents, Edge stacks, Edge groups, Update & Rollback) | Manage air-gapped/NAT'd remote Docker/K8s hosts via reverse tunnel | `portainer.endpoints.edgeAutoCreateScript`, sidebar `EdgeUpdatesSidebarItem` (BE-only) | advanced / BE-only (out of scope for single host) |
| GitOps workflows/sources (App Delivery) | Cross-environment overview of git-deployed stacks and their source repos | `portainer.gitops.workflows`, `portainer.gitops.sources` | advanced (multi-environment fleet view) |
| Kubernetes namespace/RBAC/ingress features | K8s-only surface (resource pools, annotations, YAML edit, rolling restart, etc.) | `app/react/kubernetes/**`, many `FeatureId.K8S_*` | out of scope (Docknight is Docker/Compose only) |
| Licenses | BE license key management | `portainer.licenses`, sidebar only `if (isBE)` | BE-only |
| Init wizard: admin creation | First-run: create the initial admin user | `portainer.init.admin`, `initAdmin.html:8-70` | core |
| Init wizard: restore from backup | First-run: restore Portainer state from a local file or S3 | `initAdmin.html:73-190`, S3 branch wrapped in `class="limited-be-content"` | core (file) / BE-only (S3) |

## 2. CE RBAC model, precisely

Portainer's access model has two independent layers. Read both together; neither alone is "RBAC" in the granular-permission sense.

**Layer 1: global user role** (`Role` enum, `app/portainer/users/types.ts:9-13`):
- `Admin` (1): full control of Portainer settings and every environment/resource.
- `Standard` (2): ordinary user; access to environments/resources is governed by Layer 2.
- `EdgeAdmin` (3): admin scoped to Edge management only (checked via `authService.isAdmin(true)` / `AccessHeaders.EdgeAdmin` in `app/portainer/authorization-guard.ts:66-76`).

There is also a semi-privileged **team leader**: a Standard user made leader of a team via `TeamRole.Leader` (`useUpdateRoleMutation.ts`). Team leaders can manage members of teams they lead and view/select those users in Access Viewer (`access-viewer.controller.js:27-49`), but cannot manage global settings, other teams, or non-member users.

**Layer 2: per-resource/per-environment access, via "roles" and resource control ownership.**

The RBAC role catalogue is defined client-side in `app/portainer/rbac/services/role.service.js:4-9`:

```js
new RoleViewModel(RoleTypes.ENDPOINT_ADMIN, 'Environment administrator', 'Full control of all resources in an environment', []),
new RoleViewModel(RoleTypes.OPERATOR, 'Operator', 'Operational Control of all existing resources in an environment', []),
new RoleViewModel(RoleTypes.HELPDESK, 'Helpdesk', 'Read-only access of all resources in an environment', []),
new RoleViewModel(RoleTypes.READ_ONLY, 'Read-only user', 'Read-only access of assigned resources in an environment', []),
new RoleViewModel(RoleTypes.STANDARD, 'Standard user', 'Full control of assigned resources in an environment', []),
```

Of these five, **only `Standard user` is actually usable in CE.** The access-management controller enforces this directly:

```js
// app/portainer/components/accessManagement/porAccessManagementController.js:63-77
isRoleLimitedToBE(role) {
  if (!this.limitedToBE) return false;
  return role.ID !== RoleTypes.STANDARD;
}
roleLabel(role) {
  if (!this.limitedToBE) return role.Name;
  if (this.isRoleLimitedToBE(role)) return `${role.Name} (Business Feature)`;
  return `${role.Name} (Default)`;
}
```
and the default selection is filtered to the non-BE-limited role: `selectedRole: this.roles.find((role) => !this.isRoleLimitedToBE(role))` (same file, `$onInit`). The `RbacRolesDatatable.tsx` list view (React) mirrors this: for every role except `RoleTypes.STANDARD`, CE renders a `BEFeatureIndicator` badge instead of the role being selectable (`RbacRolesDatatable.tsx:52-62`).

So the practical, enforced CE access model on a resource/environment is:
- Admins: full access to everything, always.
- Standard users: access is granted per-user or per-team via `UserAccessPolicies` / `TeamAccessPolicies` on the environment/group, always at "full control of assigned resources" (no read-only, no operator, no helpdesk tier; those require BE custom/predefined roles).
- Individual resources (containers, volumes, stacks, networks, custom templates, etc.) additionally carry their own ownership via `ResourceControlOwnership`: `public` (everyone), `private` (creator only), `restricted` (named users/teams), `administrators` (admins only). The implementation is in `app/react/portainer/access-control/types.ts:8-13` and is set through `AccessControlForm.tsx:44-52`. This ownership layer **is fully enforced in CE** and is the main practical access-control primitive available to a non-BE deployment.

What is BE-only in RBAC: fine-grained roles beyond Standard (Environment Administrator, Operator, Helpdesk, Read-only), and the Effective Access Viewer that visualizes them.

## 3. The BE gating mechanism, end to end

### 3.1 Components

| Piece | File | Role |
|---|---|---|
| `Edition` enum | `app/react/portainer/feature-flags/enums.ts:1-4` | `CE` \| `BE` |
| `FeatureId` enum | `enums.ts:9-45` | ~37 string constants, one per gated feature (e.g. `'stack-webhook'`, `'rbac-roles'`, `'k8s-edit-yaml'`) |
| Gating map + `isLimitedToBE` | `app/react/portainer/feature-flags/feature-flags.service.ts:16-58,84-86` | Hardcoded `Record<FeatureId, Edition.BE>` map (every entry present is BE-gated; CE build never sets `currentEdition` to `BE`, so `selectShow()` returns `LIMITED_BE` for every mapped id) |
| `isBE` constant | `feature-flags.service.ts:3` | `process.env.PORTAINER_EDITION === 'BE'`, baked in at build time |
| `data-edition` attribute | `app/index.html:2` | `<html data-edition="<%= process.env.PORTAINER_EDITION %>">`, set at build time from the same env var |
| `be:` Tailwind variant | `tailwind.config.js:34-35`: `addVariant('be', '&:is([data-edition="BE"] *)')` | Purely visual: swaps color tokens (blue accent to gray/dark) when running the BE build; not itself a feature gate |
| `BEFeatureIndicator` | `app/react/components/BEFeatureIndicator/BEFeatureIndicator.tsx` | Renders a "Business Feature" badge/link (to `portainer.io/business-upsell?from=<featureId>`) only `if (limitedToBE)`; otherwise renders nothing (children still render) |
| `BEOverlay` | `.../BEOverlay.tsx` | Wraps a whole section; if limited, prepends the badge and still renders `children` underneath (children are typically disabled/no-op inside) |
| `BETeaserButton` | `app/react/components/BETeaserButton.tsx` | A `Button` with `disabled` hardcoded `true` and `onClick={() => {}}`, wrapped in a tooltip describing the BE feature |
| `limitedFeatureDirective` (Angular) | `app/react/portainer/feature-flags/limited-feature.directive.ts:12-38` | `limited-feature-dir="<featureId>"`: hides the element if `FeatureState.HIDDEN`, no-ops if `VISIBLE`, else appends attributes (typically `disabled`, a CSS class) if `LIMITED_BE` |
| `withFeatureFlag` / `withEdition` HOCs | `withFeatureFlag.tsx`, `withEdition.tsx` | Component-level: render `null` unless a feature flag query resolves true / unless the build's `PORTAINER_EDITION` matches |
| `getFeatureDetails` | `BEFeatureIndicator/utils.ts:1-13` | Builds the upsell URL and calls `isLimitedToBE` |

### 3.2 Enforcement tiers, with concrete examples

**Tier 1: cosmetic badge only (feature fully works, badge is just marketing).**
Nothing in this tier actually exists in CE 2.45.0's gating map for Docker/stack features except pure "did you know BE has this" flags, but two instructive near-misses:
- Container/Stack webhook toggles (`FeatureId.CONTAINER_WEBHOOK`, `FeatureId.STACK_WEBHOOK`) render a `BEFeatureIndicator` next to the switch, yet the switch itself is not disabled by the indicator. The actual restriction comes from `adminOnlyCE` on the surrounding `Authorized` check (`useUser.tsx:96,123-124`), a *separate* CE-only-admin gate, not the BE map. So webhooks are functionally available to CE admins, only cosmetically flagged as a BE-parity feature (`docker/containers/ItemView/ContainerStatusSection/WebhookRow.tsx:113-114`, `docker/stacks/common/WebhookFieldset.tsx:63-64`).

**Tier 2: soft overlay (page renders, content is empty/disabled, "upgrade" framing dominates).**
- Auth logs page: the controller hardcodes `{ logs: [], totalCount: 0 }` (`auth-logs-view.controller.js:82`) and the whole content is wrapped in `<div class="be-indicator-container limited-be">...<div class="limited-be-content">` (`auth-logs-view.html:2-6`); the "Export as CSV" button additionally carries `limited-feature-dir` to force `disabled` (`auth-logs-view.html:23`).
- Activity (audit) logs page: `<BEOverlay variant="multi-widget" featureId={FeatureId.ACTIVITY_AUDIT}>` wraps the filter bar and table (`ActivityLogsView.tsx:47-48`).
- Kubernetes "Create from kubeconfig" wizard step: `<BEOverlay featureId={FeatureId.K8S_CREATE_FROM_KUBECONFIG}><KubeConfigTeaserForm /></BEOverlay>` (`WizardKubernetes.tsx:174-177`).
- RBAC custom roles: `RbacRolesDatatable` shows the full role list, but each non-Standard row's action cell renders only a `BEFeatureIndicator` (no way to assign it) (`RbacRolesDatatable.tsx:52-62`).

**Tier 3: hard disable (interactive control exists in the DOM but is inert).**
- Registry repository browsing: `<Button disabled={isLimited} icon={Search}>Browse</Button>` gated on `FeatureId.REGISTRY_MANAGEMENT` (`registries/ListView/RegistriesDatatable/columns/actions.tsx:47-63`).
- Kubernetes "Apply YAML changes": `BETeaserButton` with `disabled` hardcoded and a no-op `onClick` (`kubernetes/components/YAMLInspector.tsx:68-73`, `BETeaserButton.tsx:33-37`).
- S3 backup / S3 restore forms: selecting the S3 option is possible (`BoxSelector` still lists it, tagged `feature: FeatureId.S3_BACKUP_SETTING` / `FeatureId.S3_RESTORE`), but the underlying form fields are inert BE-teaser content (`backup-options.tsx:20-24`, `restore-options.tsx:18-22`, `initAdmin.html:190` wraps the whole S3 restore fieldset in `class="limited-be-content"`).
- AD / pre-baked OpenLDAP authentication method: selectable as a box option but tagged `feature: FeatureId.HIDE_INTERNAL_AUTH` / `FeatureId.EXTERNAL_AUTH_LDAP` respectively (`AuthenticationMethodSelector.tsx:29-35`, `ldap-options.tsx:17-23`); CE only ships generic custom LDAP and OAuth as functioning methods.
- Custom login banner switch: `<SwitchField featureId={FeatureId.CUSTOM_LOGIN_BANNER} .../>`; the `SwitchField` component itself force-disables when the feature id resolves to `LIMITED_BE` (`ScreenBannerFieldset.tsx:20-26`).

**Not gated at all (fully functional in CE):** internal auth, custom (non-preset) LDAP, OAuth, environment/group/tag management, per-resource access control ownership (public/private/restricted/admin-only), host security toggles per environment, local backup/restore, notifications, API keys, snapshot interval, application settings (logo/banner content itself once enabled via a workaround, templates URL), Standard-role-based team/user access assignment.

## 4. Settings that matter to a single-host deployment

| Setting | Field | Where | Relevance to Docknight |
|---|---|---|---|
| Snapshot interval | `SnapshotInterval` (e.g. `"5m"`) | `ApplicationSettingsPanel.tsx:34,58` | Controls polling cadence for environment state; directly portable concept |
| Host management features (per environment) | `EnableHostManagementFeatures` on `SecuritySettings` | `docker-features-configuration.controller.js:17,113` | Gates node/host-level actions (e.g. browsing host filesystem via agent); irrelevant without the Portainer Agent, but the *concept* (admin opt-in for privileged host operations) is worth keeping |
| Allow stack management for regular users | `AllowStackManagementForRegularUsers` | same file:22,119; consumed in `stacksController.js:50` and `DashboardView.tsx:126-127` | Directly maps to Docknight's single-admin model: with one admin account this toggle is moot, but the pattern (admin-only vs. delegated) is the seed of any future multi-user support |
| Allow volume browser for regular users | `AllowVolumeBrowserForRegularUsers` | same file:18,114 | Same shape; only relevant if Docknight ever adds non-admin users |
| Allow privileged mode / host namespace / device mapping / container capabilities / sysctl / security-opt for regular users | `Allow*ForRegularUsers` | same file:19-26,115-123 | A single-admin panel does not need per-user restriction; these are all no-ops if there is only ever one account. Cut. |
| Edge settings (ping/snapshot/command interval, tunnel address, enforce Edge ID) | `Settings.Edge`, `EnableEdgeComputeFeatures` | `EdgeComputeSettings.tsx:35-40,86-118` | Not relevant: Docknight manages one local Docker host, no NAT/air-gap tunnel needed |
| Password policy (min length) | `InternalAuthSettings.RequiredPasswordLength` | `InternalAuth.tsx:22-33,44-53` | Worth keeping as a minimal server-side validation even for a single admin account |
| Session lifetime | shown in `AuthenticationView/SessionLifetimeSelect.tsx` | Same settings page | Worth keeping: a sane default idle/absolute session timeout is good practice for any admin panel exposed on a LAN |

## 5. Distilled MVP table for Docknight

Docknight: single host, single admin account, Docker Compose focused, Svelte 5 + Material 3, mobile-first.

### Keep

| Feature | Rationale |
|---|---|
| Containers (list, start/stop/restart/remove, logs, inspect, exec) | Core Docker daily-driver surface; this is the product |
| Images (list, pull, remove, prune) | Needed to manage what Compose stacks run |
| Networks (list, create, remove) | Needed for Compose-created networks and troubleshooting |
| Volumes (list, create, remove) | Needed for persistent Compose data |
| Stack lifecycle (deploy, start, stop, remove, redeploy, edit) | This *is* Docknight's primary object; covered fully in `03b-stacks-compose.md` |
| Git-backed stack deploy (clone, pull-now, redeploy on interval) | Enables "point at a repo, get a running stack" workflow without abandoning a GUI editor |
| Access control ownership (public/private/admin-only) on resources | Cheap, already-enforced-in-CE primitive; keep as a simple "who can see/touch this stack" toggle even with one admin, since it is nearly free and future-proofs multi-user |
| API keys / access tokens | Needed for any CLI/automation/webhook integration without exposing the admin password |
| Local backup/restore (config export/import) | Single-file disaster recovery is cheap to keep and valuable for a self-hosted tool |
| Snapshot/poll interval setting | Simple, useful knob; keep as a single settings field |
| Application settings (logo optional, session timeout, password policy) | Minimal, cheap, and improves a self-hosted admin panel's baseline security posture |

### Simplify

| Feature | Rationale |
|---|---|
| Users/teams/RBAC | Docknight has exactly one admin; replace the entire users/teams/roles/access-viewer subsystem with a single local admin account (username+password or passkey) and drop team/role concepts entirely rather than porting a scaled-down RBAC |
| Registries | Keep registry *credentials* (needed to pull private images) but drop the registry management CRUD screen's complexity (no per-environment registry access assignment, no BE-teased "Browse" feature); a flat credential list is enough |
| Activity logging | Portainer's audit log is BE-gated and enterprise-shaped (filters by context/type, CSV export); Docknight only needs a lightweight local event feed (who/what/when) for its one admin, not a compliance audit trail |
| Templates (app/stack templates) | Keep the *concept* (a curated list of ready-to-deploy Compose snippets) but drop the external template-URL/registry system; ship a small built-in set instead, covered in `03b-stacks-compose.md` |
| Notifications | Keep as a lightweight toast/history feed (already trivial in Portainer, client-side only) but drop the dedicated full-page datatable with bulk-select/remove; a simple dropdown is enough |
| Image build/pull UX | Keep pull-by-tag and Dockerfile build, but simplify Portainer's multi-tab build form (upload/URL/repository/editor/custom Dockerfile path) down to the two paths Compose actually needs: pull by tag, or build from a path referenced in the compose file |

### Cut

| Feature | Rationale |
|---|---|
| Kubernetes (entire subsystem: namespaces, Helm, YAML editor, annotations, resource pools, RBAC-for-k8s) | Docknight is explicitly Compose/Docker-only; this is Portainer's single largest feature area and completely out of scope |
| Swarm (services, nodes, scaling, secrets/configs as swarm objects) | Single-host Compose does not use Swarm; cut entirely along with the services/nodes UI |
| Edge Compute (Edge agents, Edge stacks, Edge groups, Update & Rollback, tunnel settings) | Built for managing many remote/NAT'd hosts from one Portainer server; irrelevant to a single local host |
| Multi-environment management (Environments list, Groups, Tags, environment wizard) | Docknight manages exactly one Docker host; there is nothing to group or switch between |
| GitOps "App Delivery" workflows/sources fleet view | A cross-environment rollup view; meaningless with one environment |
| Custom RBAC roles (Environment Administrator/Operator/Helpdesk/Read-only) and Effective Access Viewer | BE-only in Portainer anyway, and moot with a single admin account |
| Licenses screen | BE-only, not applicable |
| S3 backup scheduling / S3 restore | BE-only; local file backup covers the single-host use case entirely |
| Container/Stack webhooks | Niche automation feature tied to CI/CD pipelines external systems call into; a single-host personal panel does not need inbound redeploy webhooks in v1 |
| Custom login banner, screen banner, donation/contributor headers | Marketing/compliance chrome irrelevant to a personal tool |
| Kube-only settings panels (SSL passthrough for k8s ingress, Helm cert, Kube settings, deployment options) | Dead weight without Kubernetes |

## 6. What Portainer's feature sprawl costs the UX

Portainer CE's "Administration" sidebar section alone (`app/react/sidebar/SettingsSidebar.tsx`) exposes, in a single always-visible admin nav tree: Users, Teams, Roles, Environments, Groups, Tags, Update & Rollback (BE), Registries, Licenses (BE), two Logs sub-items (Authentication, Activity), Notifications, and a Settings parent with three more sub-items (General, Authentication, Shared Credentials (BE), Edge Compute). That is 15+ distinct destinations before a user has touched a single container. The "General" settings destination is itself not one screen but a vertically stacked sequence of up to seven independent widgets (Application, Kubernetes, Helm cert, SSL, Experimental (BE), Hidden containers, Backup), so "Settings" is really nine-plus semantically distinct forms hiding behind three sidebar labels. On top of that, a CE installation surfaces at least eight separate BE-upsell touch points reachable during ordinary use: the RBAC roles table, the Effective Access Viewer, Auth logs, Activity logs, registry Browse buttons, the S3 backup/restore options, the custom-login-banner switch, and the AD/OpenLDAP authentication presets. Each renders a "Business Feature" badge or a fully wrapped, functionally inert overlay rather than being hidden outright. For an operator who only wants to deploy and monitor Compose stacks on one machine, this produces a navigation tree and settings surface where the large majority of destinations are either multi-tenant plumbing (users/teams/roles for a team that doesn't exist), fleet-management plumbing (environments/groups/tags/edge for a fleet that doesn't exist), or non-functional advertising for a paid tier. Docknight's opportunity is structural, not cosmetic: collapsing that 15-destination admin tree and nine-widget settings page down to the handful of rows in the "keep" table above, with zero dead ends, is itself most of the "lighter Portainer" value proposition, independent of any mobile-specific UI work.
