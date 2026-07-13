# UI

`packages/ui` owns reusable delivery-layer UI code and resources. It is an
outer ownership grouping, not an inner business-rule ring.

Language roots contain framework-specific components, hooks, controllers,
design tokens, and localized presentation resources. UI packages may depend
inward on core and interface adapters, but core, contracts, adapters, and
infrastructure must not depend outward on UI.

UI packages must receive networking, persistence, observability, and other
infrastructure capabilities through app composition or adapter interfaces.
Framework-free presenters and boundary translation belong in
`packages/adapters`, while app-specific screens and startup wiring remain in
`apps/*`.
