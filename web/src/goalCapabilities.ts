export type GoalCapabilities = {
  create: boolean;
  edit: boolean;
  resume: boolean;
  clear: boolean;
  pause: boolean;
  reason?: string | null;
};
