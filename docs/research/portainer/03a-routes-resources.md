# Portainer CE 2.45.0: Docker-standalone routes and resource actions

Scope: `docker.*` uirouter state tree and the per-resource action surface for containers, images, networks, volumes, services (swarm), configs, secrets, nodes, events, and host. Stacks/Compose, templates, registries, and image build/pull mechanics are covered in `03b-stacks-compose.md`. Platform-level settings, CE RBAC, and BE gating mechanics are in `03c-platform-gating.md`. Kubernetes is out of scope entirely (this repo path is Docker-only).

All paths are relative to `.ref/portainer/`. Commit: `4a4a157`.

## 1. Route map: the `docker` state tree

Root abstract state `docker` (`app/docker/__module.js:16-19`, parent `endpoint`, url `/docker`) gates entry: it pings the target environment, redirects to `portainer.home` if the environment is not a Docker-standalone/agent/edge-agent type, and marks the environment down if unreachable. Every child state below inherits this guard. Registration site column shows AngularJS legacy (`__module.js` or `views/**`) vs React (`react/views/*.ts` via `r2a`).

| State name | URL | Component/controller | Registered in | Purpose |
|---|---|---|---|---|
| `docker` | `/docker` | (abstract, `onEnter` health check) | `__module.js:16` | Environment gate for all Docker views |
| `docker.dashboard` | `/dashboard` | `dockerDashboardView` (React) | `react/views/index.ts:25-27`, route `__module.js:152-160` | Environment overview: resource counts (containers/images/volumes/networks), quick links |
| **Containers** | | | | |
| `docker.containers` | `/containers` | `containersView` (React `ListView`) | `react/views/containers.ts:49-59` | Container list/datatable |
| `docker.containers.container` | `/:id?nodeName` | `containerItemView` (React `ItemView`) | `react/views/containers.ts:61-69` | Container detail page (see section 4) |
| `docker.containers.container.attach` | `/attach` | `ContainerConsoleController` (legacy) | `react/views/containers.ts:71-79` | Attach to container's main process stdio |
| `docker.containers.container.exec` | `/exec` | `ContainerConsoleController` (legacy) | `react/views/containers.ts:81-89` | Interactive exec console (spawns new process) |
| `docker.containers.new` | `/new?nodeName&from` | `createContainerView` (React `CreateView`) | `react/views/containers.ts:91-99` | Create container form; `from` param drives Duplicate/Edit |
| `docker.containers.container.inspect` | `/inspect` | `dockerContainerInspectView` (React `InspectView`) | `react/views/containers.ts:101-108` | Raw JSON inspect output |
| `docker.containers.container.logs` | `/logs` | `ContainerLogsController` (legacy) | `react/views/containers.ts:110-118` | Streamed/paged container stdout+stderr |
| `docker.containers.container.stats` | `/stats` | `containerStatsView` (React `StatsView`) | `react/views/containers.ts:120-127` | Live CPU/memory/network/IO charts |
| **Images** | | | | |
| `docker.images` | `/images` | `imagesListView` (React `ListView`) | `react/views/images.ts`, route `__module.js:198-205` | Image list, pull-image widget |
| `docker.images.image` | `/:id?nodeName` | `ImageController` (legacy) | `__module.js:207-215` | Image detail (layers, tags, dockerfile if available) |
| `docker.images.build` | `/build` | `BuildImageController` (legacy) | `__module.js:217-226` | Build image from Dockerfile/upload/URL/git (see 03b) |
| `docker.images.import` | `/import` | `ImportImageController` (legacy) | `__module.js:228-236` | Import image from a `.tar` |
| **Networks** | | | | |
| `docker.networks` | `/networks` | `networksListView` (React `ListView`) | `react/views/networks.ts`, route `__module.js:238-245` | Network list |
| `docker.networks.network` | `/:id?nodeName` | `networkDetailsView` (React `ItemView`) | `react/views/index.ts:29-32`, route `__module.js:264-271` | Network detail: details, options, connected containers |
| `docker.networks.new` | `/new` | `CreateNetworkController` (legacy) | `__module.js:273-282` | Create network form |
| **Swarm / Nodes** | | | | |
| `docker.nodes` | `/nodes` | (abstract) | `__module.js:284-290` | Parent for node detail routes |
| `docker.nodes.node` | `/:id` | `nodeDetailsView` (legacy `NodeDetailsViewController`) | `__module.js:292-303` | Node hardware/engine/availability detail (section 3, host resource) |
| `docker.nodes.node.browse` | `/browse` | `nodeBrowserView` (legacy) | `__module.js:305-312` | Agent-only host filesystem browser scoped to that node |
| `docker.swarm` | `/swarm` | `SwarmController` (legacy) | `__module.js:463-470` | Swarm-wide overview: node list, join tokens |
| `docker.swarm.visualizer` | `/visualizer` | `SwarmVisualizerController` (legacy) | `__module.js:472-480` | Node/service/task placement visualizer |
| `docker.swarm.featuresConfiguration` | `/feat-config` | `dockerFeaturesConfigurationView` (legacy) | `__module.js:583-590` | Same settings as `docker.host.featuresConfiguration` below, swarm variant |
| `docker.swarm.registries` / `.registries.access` | `/registries`, `/:id/access` | `environmentRegistriesView` / `dockerRegistryAccessView` | `__module.js:604-635` | Registry access scoping for swarm env (see 03b) |
| **Services (Swarm)** | | | | |
| `docker.services` | `/services` | `ServicesController` (legacy, embeds React `docker-services-datatable`) | `__module.js:352-360`, template `views/services/services.html:3-10` | Service list |
| `docker.services.service` | `/:id` | `ServiceController` (legacy) | `__module.js:362-370` | Service detail (section-by-section edit form, see 3b) |
| `docker.services.new` | `/new` | `CreateServiceController` (legacy) | `__module.js:372-381` | Create swarm service |
| `docker.services.service.logs` | `/logs` | `ServiceLogsController` (legacy) | `__module.js:383-390` | Aggregated logs across all tasks of a service |
| `docker.tasks` (abstract) / `.tasks.task` / `.tasks.task.logs` | `/tasks`, `/:id`, `/logs` | `TaskController` / `TaskLogsController` | `__module.js:471-491` | Individual swarm task detail and logs |
| **Configs** | | | | |
| `docker.configs` | `/configs` | `configsListView` (React `ListView`) | `react/views/configs.ts`, route `__module.js:71-81` | Swarm config list |
| `docker.configs.config` | `/:id` | `ConfigController` (legacy) | `__module.js:83-92` | Config detail (immutable content, labels, access control) |
| `docker.configs.new` | `/new?id` | `CreateConfigController` (legacy) | `__module.js:94-106` | Create config |
| **Secrets** | | | | |
| `docker.secrets` | `/secrets` | `SecretsController` (legacy, embeds React `SecretsDatatable`) | `__module.js:322-331` | Secret list |
| `docker.secrets.secret` | `/:id` | `SecretController` (legacy) | `__module.js:333-341` | Secret detail (immutable, delete + labels + access control) |
| `docker.secrets.new` | `/new` | `CreateSecretController` (legacy) | `__module.js:343-351` | Create secret |
| **Volumes** | | | | |
| `docker.volumes` | `/volumes` | `VolumesController` (legacy, embeds React `VolumesDatatable`) | `__module.js:436-444` | Volume list |
| `docker.volumes.volume` | `/:id?nodeName` | `VolumeController` (legacy) | `__module.js:446-454` | Volume detail: mountpoint, driver, options, containers using it, remove/browse |
| `docker.volumes.volume.browse` | `/browse` | `BrowseVolumeController` (legacy) | `__module.js:456-464` | Agent-only browse of volume contents |
| `docker.volumes.new` | `/new` | `CreateVolumeController` (legacy) | `__module.js:466-475` | Create volume |
| **Events** | | | | |
| `docker.events` | `/events` | `eventsListView` (React `ListView`) | `react/views/index.ts:28`, route `__module.js:186-194` | Docker daemon event log, 24h default window |
| **Host** | | | | |
| `docker.host` | `/host` | `hostView` (legacy) | `__module.js:162-170` | Standalone host overview: OS/CPU/memory, engine, plugins, GPU/disk panels (agent-only) |
| `docker.host.browser` | `/browser` | `hostBrowserView` (legacy) | `__module.js:172-180` | Agent-only root filesystem browser (`portainer.agent` module) |
| `docker.host.featuresConfiguration` | `/feat-config` | `dockerFeaturesConfigurationView` (legacy) | `__module.js:568-577` | Host management toggles, RBAC-for-regular-users toggles, GPU UI toggle (section 3, Host) |
| `docker.host.registries` / `.registries.access` | `/registries`, `/:id/access` | `environmentRegistriesView` / `dockerRegistryAccessView` (admin-only, `AccessHeaders.Admin`) | `__module.js:594-635`, guard `portainer/authorization-guard.ts:8-12,58-68` | Registry access scoping for this env (see 03b) |
| **Stacks** (see 03b) | `docker.stacks*` | `stackItemView` / `createStackView` (React) | `__module.js:322-350` | Compose stack CRUD, out of scope here |
| **Templates** (see 03b) | `docker.templates`, `docker.templates.custom*` | `appTemplatesView` / `*CustomTemplatesView` | `__module.js:110-146` | App Template gallery and custom templates, out of scope here |

## 2. Per-resource action inventory

Legend for **Classification**: `core` = needed for a single-host Compose-first admin panel; `advanced` = useful but deferrable; `enterprise/multi-tenant` = only matters with multiple users/teams/environments; `BE-only` = gated to Business Edition in the CE source (see 03c for the gating mechanism itself).

### 2.1 Containers

Bulk actions in list toolbar from `app/react/docker/containers/ListView/ContainersDatatable/ContainersDatatableActions.tsx:36-172`; per-container actions in `app/react/docker/containers/ItemView/ContainerActionsSection/{PrimaryActions.tsx,SecondaryActions.tsx}`; row quick-links in `app/react/docker/containers/ListView/ContainersDatatable/columns/quick-actions.tsx` and `app/react/docker/containers/components/ContainerQuickActions/ContainerQuickActions.tsx`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Start | Bulk toolbar, detail primary actions | No | `DockerContainerStart`; enabled only if a stopped/created/exited container is selected (`ContainersDatatableActions.tsx:44-50,84-93`) | core |
| Stop | Bulk toolbar, detail primary actions | No | `DockerContainerStop`; enabled only if a running-family container selected | core |
| Kill | Bulk toolbar, detail primary actions | No | `DockerContainerKill`; disabled if any selected item already stopped | core |
| Restart | Bulk toolbar, detail primary actions | No | `DockerContainerRestart` | core |
| Pause | Bulk toolbar, detail primary actions | No | `DockerContainerPause`; enabled only if a running item selected | core |
| Resume (unpause) | Bulk toolbar, detail primary actions | No | `DockerContainerUnpause`; enabled only if a paused item selected | core |
| Remove | Bulk toolbar, detail primary actions, row menu (implicit via datatable select+action) | Yes, `confirmContainerDeletion` modal with an "automatically remove non-persistent volumes" switch (`common/confirm-container-delete-modal.ts:5-9`) | `DockerContainerDelete`; title warns if any selected container is running (`ContainersDatatableActions.tsx:213-225`, `PrimaryActions/RemoveButton.tsx:29-40`); disabled for the Portainer container itself | core |
| Create (Add container) | List toolbar button, links to `docker.containers.new` | No | `DockerContainerCreate` | core |
| Recreate | Detail secondary actions | Yes, `ConfirmRecreationModal` asking whether to pull latest image (skipped if image is a bare sha256 digest) | Hidden for Swarm-service containers, AutoRemove containers, and Podman (`useCanRecreateContainer.ts:9-28`); disabled for the Portainer container | core |
| Duplicate/Edit | Detail secondary actions | No (navigates to create form with `from` param) | Links to `docker.containers.new?from=<id>`; same visibility exclusions as Recreate minus the Podman check (see `useCanDuplicateEditContainer.ts`) | core |
| Rename | Detail status panel, inline edit icon next to name | No (inline form) | `DockerContainerRename`, `ContainerStatusSection/NameRow.tsx:16-49` | core |
| Commit to image ("Create image") | Detail page, "Create image" widget | No (form submit) | `DockerImageCreate`; wraps `docker commit`, supports pushing straight to a registry (`CreateImageSection.tsx:29-77`) | advanced |
| Update restart policy | Detail page, Container details widget | No (inline form) | `useUpdateRestartPolicyMutation`, `ContainerDetailsSection.tsx:72-80` | core |
| Connect to network | Detail page, "Connected Networks" panel | No (form submit) | `ConnectNetworkForm.tsx`, embedded as the datatable `description` slot | core |
| Disconnect ("Leave network") | Detail page, "Connected Networks" panel row action; also from Network detail page's own containers table | No | `DockerNetworkDisconnect` (`ContainerNetworksDatatable/actions.tsx:24-45`, `networks/ItemView/NetworkContainersTable.tsx:69-92`) | core |
| Container webhook toggle | Detail status panel, Webhook row | No (switch) | `PortainerWebhookCreate`/`PortainerWebhookDelete`; only shown when Recreate would be allowed and env is not Edge-agent; `FeatureId.CONTAINER_WEBHOOK` is BE-gated (`WebhookRow.tsx:36-64`, `feature-flags/enums.ts:33`) | BE-only (badge/nag in CE; underlying create/delete calls are plain Portainer webhook APIs) |
| Logs (quick action + detail link) | Row quick-actions column, detail "Action links" row | No | `DockerContainerLogs`, opens `docker.containers.container.logs` | core |
| Inspect (quick action + detail link) | Row quick-actions column, detail "Action links" row | No | `DockerContainerInspect` | core |
| Stats (quick action + detail link) | Row quick-actions column (only if container active), detail "Action links" row | No | `DockerContainerStats` | advanced |
| Exec console (quick action + detail link) | Row quick-actions column (only if active), detail "Action links" row | No | `DockerExecStart`, opens `docker.containers.container.exec` | core |
| Attach console (quick action + detail link) | Row quick-actions column (only if active), detail "Action links" row | No | `DockerContainerAttach`, opens `docker.containers.container.attach` | advanced |
| Hide individual quick actions | List table settings menu | No | Per-user column visibility prefs stored in table settings (`ContainersDatatableSettings.tsx`, consumed by `quick-actions.tsx:22-31`) | advanced |

### 2.2 Images

From `app/react/docker/images/ListView/ImagesDatatable/{ImagesDatatable.tsx,RemoveButtonMenu.tsx,ImportExportButtons.tsx,PruneButton.tsx}` and `app/react/docker/images/ListView/ListView.tsx`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Pull image | List page, `PullImageFormWidget` above the datatable | No (form submit) | `usePullImageMutation`; separate from Build (03b) | core |
| Remove | List toolbar (bulk) | Yes, `confirmDestructive` warning that associated tags are removed too | `DockerImageDelete` (`RemoveButtonMenu.tsx:29-46,73-84`) | core |
| Force Remove | List toolbar, dropdown next to Remove | Yes, stronger warning ("even if used by stopped containers") | Same authorization, `force: true` on delete call (`RemoveButtonMenu.tsx:47-71`) | advanced |
| Prune (remove unused) | List toolbar | Yes, `ConfirmPruneModal` with "prune all" and "clear build cache" options | `DockerImagePrune`, `adminOnlyCE` (CE: admin-only regardless of custom role) (`PruneButton.tsx:37-49`) | advanced |
| Import (from `.tar`) | List toolbar, links to `docker.images.import` | No | `DockerImageLoad` | advanced |
| Export (to `.tar`) | List toolbar (bulk) | Yes, `confirmImageExport` | `DockerImageGet`; blocked if any selected image is untagged or images span multiple nodes (`ImportExportButtons.tsx:59-83`) | advanced |
| Build | List toolbar, links to `docker.images.build` | No | `DockerImageBuild`; full mechanics in 03b | core |

### 2.3 Networks

From `app/react/docker/networks/ListView/NetworksDatatable.tsx` and `app/react/docker/networks/ItemView/*`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Create | List toolbar | No | `DockerNetworkCreate` | core |
| Remove | List toolbar (bulk) | Yes, `DeleteButton` built-in confirm | Requires both `DockerNetworkDelete` and `DockerNetworkCreate`; system networks are excluded from selection (`isRowSelectable`, `NetworksDatatable.tsx:69,79-99`) | core |
| Remove (single) | Detail page | Yes | Same authorization, `NetworkDetailsTable`'s remove callback (`networks/ItemView/ItemView.tsx:64-73,97-104`) | core |
| Disconnect container | Network detail page, "Containers" table row; also from container's own Networks panel | No | `DockerNetworkDisconnect` (`NetworkContainersTable.tsx:69-92`) | core |
| View swarm overlay sub-networks | List, expandable row | No | `NestedNetworksDatatable`, only when `Subs` present (i.e. swarm overlay networks per-node) | advanced (swarm-only) |

### 2.4 Volumes

From `app/react/docker/volumes/ListView/VolumesDatatable/TableActions.tsx` and `app/docker/views/volumes/edit/volume.html`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Create | List toolbar | No | `DockerVolumeCreate` | core |
| Remove | List toolbar (bulk), detail page single-remove button | Yes (`DeleteButton` confirm; detail page uses plain `ng-click` without dialog) | `DockerVolumeDelete` | core |
| Browse contents | Detail page, "Browse" button next to ID | No (opens `docker.volumes.volume.browse`) | `DockerAgentBrowseList`; agent-only, invisible on plain docker-socket environments (`volumes/edit/volume.html:9-15`) | advanced (agent-only) |
| View containers using volume | Detail page, "Containers using volume" panel | No (read-only) | Lists mount path and read-only flag per container (`volume.html:74-93`) | core |

### 2.5 Services (Swarm)

From `app/react/docker/services/ListView/ServicesDatatable/{TableActions.tsx,columns/schedulingMode/ScaleForm.tsx}`, `app/react/docker/swarm/SwarmView/NodesDatatable/columns/availability.tsx`, and `app/docker/views/services/edit/service.html`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Create | List toolbar, links to `docker.services.new` | No | `DockerServiceCreate` | advanced (swarm-only) |
| Force update (with optional re-pull) | List toolbar (bulk), detail page | Yes, `confirmServiceForceUpdate` asking whether to pull latest image | `DockerServiceUpdate`; recreates all tasks (`TableActions.tsx:34-46,66-88`, `service.html:118-131`) | advanced (swarm-only) |
| Remove | List toolbar (bulk), detail page | Yes, `DeleteButton` confirm warning all containers of the service are removed | `DockerServiceDelete` (`TableActions.tsx:48-55,90-98`, `service.html:145-156`) | advanced (swarm-only) |
| Scale (inline replica count) | List row (schedulingMode column) | No (inline number input + submit/cancel icons) | `useUpdateServiceMutation`; disabled until value differs from current replica count (`ScaleForm.tsx:60-66`) | advanced (swarm-only) |
| Rollback | Detail page | No (single click, only one level of history) | `DockerServiceUpdate`; note in UI that a second click without changes undoes the previous rollback (`service.html:97-99,126-137`) | advanced (swarm-only) |
| Service webhook toggle | Detail page | No (switch) | Admin-only (`ng-if="isAdmin"`), hidden for Edge agent envs; same automate-redeploy pattern as container webhook, not marked BE in this legacy template (`service.html:59-84`) | advanced |
| Edit spec (image, env, mounts, networks, ports, resources, placement, restart policy, update config, logging, labels, configs, secrets attachments) | Detail page, per-section includes | No (each section is an inline form, batched into one "Apply changes"/"Reset changes" footer) | `DockerServiceUpdate`; sections enumerated via quick-nav sidebar (`service.html:159-244`) | advanced (swarm-only) |
| View tasks | Detail page, bottom "Tasks" panel; also `docker.tasks.task` / `.logs` | No | Per-task placement, state, and log stream | advanced (swarm-only) |
| Node availability (active/pause/drain) | Node detail page, editable select + Apply/Reset | No confirm, but staged ("Apply changes"/"Reset changes") | Client-side `NodeService` PUT to `/nodes/{id}/update`; no explicit `authorization` attribute found on the control itself, gated only by the swarm-manager requirement (`swarm-node-details-panel.html:16-24,49-58`, `swarm-node-details-panel-controller.js:44-47`) | advanced (swarm-only) |
| Node labels add/edit/remove | Node detail page | No (batched into Apply changes) | `node-labels-table`, same Apply/Reset footer | advanced (swarm-only) |

### 2.6 Configs

From `app/react/docker/configs/ListView/ConfigsDatatable/{ConfigsDatatable.tsx,DeleteConfigButton.tsx}` and legacy `docker.configs.config`/`docker.configs.new`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Create | List toolbar | No | `DockerConfigCreate` | advanced (swarm-only) |
| Remove | List toolbar (bulk) | Yes, `DeleteButton` confirm | `DockerConfigDelete`; deletes sequentially via `promiseSequence` (`DeleteConfigButton.tsx:19-36,49-56`) | advanced (swarm-only) |
| View detail (immutable content, labels, access control) | Detail page | No (read-only content; access control is editable) | Configs cannot be edited in place, only recreated | advanced (swarm-only) |

### 2.7 Secrets

From `app/react/docker/secrets/ListView/SecretsDatatable.tsx` and legacy `docker.secrets.secret`/`docker.secrets.new`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| Create | List toolbar | No | `DockerSecretCreate` | advanced (swarm-only) |
| Remove | List toolbar (bulk), detail page single-remove | Yes on list (`DeleteButton`); detail page is plain `ng-click` | `DockerSecretDelete`; select-disabled entirely if the user lacks both create+delete (`SecretsDatatable.tsx:56-59,88-101`) | advanced (swarm-only) |
| View ownership column | List | No | `createOwnershipColumn`, shows resource-control owner | enterprise/multi-tenant |
| View detail (immutable content, labels, access control) | Detail page | No | Same immutability pattern as Configs (`secrets/edit/secret.html`) | advanced (swarm-only) |

### 2.8 Nodes / Swarm cluster

Covered mostly under Services above (node availability/labels live on the node detail page). Cluster-level views:

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| View swarm overview (node list, manager/worker roles) | `docker.swarm` | No | `SwarmController`, legacy | advanced (swarm-only) |
| View cluster visualizer (service/task placement across nodes) | `docker.swarm.visualizer` | No | Read-only diagram | advanced (swarm-only) |
| Browse node's host filesystem | `docker.nodes.node.browse` | No | Agent-only, same `HostBrowserController` actions as section 2.10 | advanced (agent + swarm only) |

### 2.9 Events

From `app/react/docker/events/{ListView.tsx,EventsDatatables.tsx}`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| View event stream | `docker.events` | No | Defaults to a rolling 24h window (`since`/`until` computed with `moment()`, `ListView.tsx:19-25`); no server-side push, this is a point-in-time fetch of the Docker events log | core |
| Reload | Page header reload icon | No | Re-runs the same 24h-window query | core |

### 2.10 Host

From `app/docker/views/host/*`, `app/docker/components/host-overview/*`, `app/agent/components/host-browser/hostBrowserController.js`, and `app/docker/views/docker-features-configuration/*`.

| Action | Where | Confirm? | Notes | Class |
|---|---|---|---|---|
| View host overview (OS, CPU, memory, engine version, volume/network plugins) | `docker.host` | No | Available for any environment type; only the "browse" link needs agent (`host-overview.html:1-12`) | core |
| View devices / disks panels | `docker.host` | No | Agent-only, requires `enableHostManagementFeatures` and agent API v2+ (`host-overview.html:7-8`) | advanced (agent-only) |
| Browse host filesystem (list/rename/delete/download/upload) | `docker.host.browser` | Yes for delete (`confirmDelete`); rename/upload/download not confirmed | `DockerAgentBrowseList`-gated visibility; entire feature lives in the `portainer.agent` module and needs the Portainer Agent bind-mounting `/host` (`hostBrowserController.js:59-138`) | advanced (agent-only) |
| Configure host features (toggle host management, volume browser for non-admins, GPU UI, and eight "hide X for regular users" security switches) | `docker.host.featuresConfiguration` | No (single "Save configuration" submit) | Admin-only page; most switches only matter with more than one user (`docker-features-configuration.html:8-158`) | enterprise/multi-tenant (RBAC-shaping toggles) except the GPU-UI and host-management toggles which are `core`/`advanced` respectively |
| Show image up-to-date indicator | Same page | No (switch) | `FeatureId.IMAGE_UP_TO_DATE_INDICATOR`, BE-gated (`docker-features-configuration.html:145-153`, `feature-flags/enums.ts:30`) | BE-only |
| Enable change window (GitOps auto-update schedule) | Same page | No (switch) | `limitedFeatureAutoUpdate`, BE-gated (see 03c) | BE-only |

## 3. Container detail page anatomy

Rendered top-to-bottom by `app/react/docker/containers/ItemView/ItemView.tsx:53-108`:

1. **Page header** - breadcrumbs (Containers > name), title "Container details".
2. **Actions widget** (`ContainerActionsSection.tsx:39-64`) - `PrimaryActions` button group (Start, Stop, Kill, Restart, Pause, Resume, Remove) then `SecondaryActions` group (Recreate, Duplicate/Edit), all gated behind the combined container-authorizations check.
3. **Container status widget** (`ContainerStatusSection.tsx:26-84`) - details table: ID, Name (inline rename), IP address (if present), Status badge, Created, Start time or Finished time, Webhook row (non-Edge envs only), Action links row (Logs/Inspect/Stats/Console/Attach).
4. **Access control panel** (`@/react/portainer/access-control/AccessControlPanel`) - resource ownership/visibility for this container.
5. **Health status** (`HealthStatus.tsx`) - only rendered if the container defines a Docker healthcheck.
6. **Create image widget** (`CreateImageSection.tsx:39-59`) - commit-to-image form (registry push optional).
7. **Container details widget** (`ContainerDetailsSection.tsx:36-84`) - Image, Port configuration, CMD, ENTRYPOINT, Environment variables, Labels, Restart policy (editable), Sysctls, Security options, GPU.
8. **Volumes widget** (`VolumesSection.tsx:16-38`) - one row per mount, only rendered if mounts exist.
9. **Connected Networks datatable** (`ContainerNetworksDatatable.tsx:23-71`) - one row per attached network with a "Leave network" action per row, plus a "Connect to network" form in the datatable's description slot; only rendered if the container has any network settings.

## 4. What a Compose-first panel can skip

Swarm-only resources (services, tasks, swarm cluster view/visualizer, configs, secrets, and the swarm-mode node-availability/labels controls) can be omitted entirely because Docknight targets a single Docker host running plain `docker compose`, never `docker swarm init`; none of those Docker Engine endpoints exist outside swarm mode. Host/node file-browsing (`docker.host.browser`, `docker.nodes.node.browse`, volume browse) can also be dropped because it is gated behind the Portainer Agent's bind-mounted `/host`, which a lightweight single-admin tool talking directly to the Docker socket will never deploy. Events, image import/export, and registry-access-scoping are marginal and can be deferred rather than omitted, since they are simple Docker Engine proxies with no swarm or agent dependency and only add UI surface, not backend complexity.
