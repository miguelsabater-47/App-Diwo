import type { DoorScanDevelopmentConfig } from "./door-scan-development-model";

// Local development only. This configuration is ignored outside localhost:3000
// with Development keys and an independently verified admin/door_staff role.
// Set enabled to false to restore real event reads and check-in requests.
// Outcomes: admitted, already_used, revoked, unknown, connection_error.
// Changing this file remounts the same scanner UI; there are no on-screen controls.
export const doorScanDevelopmentConfig: DoorScanDevelopmentConfig = {
  enabled: true,
  outcome: "admitted",
};
