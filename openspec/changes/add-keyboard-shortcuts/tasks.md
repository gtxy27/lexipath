## 1. Proposal Tasks
- [x] 1.1 Confirm the list of shortcut-triggered actions and their exact semantics (sidebar / web enhancement / floating button / subtitle enhancement)
- [x] 1.2 Decide default key strategy (default only `Alt+Shift+L`; others unassigned)
- [x] 1.3 Add delta specs for `keyboard-shortcuts` + run `openspec validate add-keyboard-shortcuts --strict --no-interactive`

## 2. Implementation Tasks (After Approval)
- [x] 2.1 Add commands to Chrome + Firefox manifests
- [x] 2.2 Implement background command dispatch and integrate with existing feature toggles
- [x] 2.3 Add Options UI section listing commands + current bindings via `commands.getAll()`
- [x] 2.4 Add Options button/link to open `chrome://extensions/shortcuts` (with a fallback if navigation is blocked)
- [x] 2.5 Add tests (at minimum: command dispatch wiring + Options rendering of bindings)
