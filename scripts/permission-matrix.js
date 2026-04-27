/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/permission-matrix.js  —  EQ Solves Field
// Static role × permission map. Consumed by scripts/permissions.js
// (the EQ_PERMS.can() helper).
//
// Load order: BEFORE permissions.js. No external deps.
//
// To regenerate v2+:
//   1. Open eq-context/drafts/eq-field-roles-2026-04-27/permission-matrix.html
//   2. Tick / untick to taste
//   3. Click "Copy as JSON"
//   4. Paste over the object below, bump @version + last_updated.
//
// @version       v1
// @last_updated  2026-04-27
// @source        eq-context/drafts/eq-field-roles-2026-04-27/permissions-by-role-v1.json
// Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.5
// ─────────────────────────────────────────────────────────────

window.EQ_PERMISSIONS = {
  manager: [
    'roster.view_own', 'roster.view_team', 'roster.view_all', 'roster.request_changes',
    'roster.edit_team', 'roster.approve_changes',
    'ts.submit_own', 'ts.edit_own', 'ts.view_own', 'ts.view_team', 'ts.approve',
    'ts.send_reminders', 'ts.view_completion',
    'ph.view_dashboard', 'ph.tick_track_hours', 'ph.set_budget', 'ph.view_per_person',
    'leave.view_own_balance', 'leave.view_team_balances', 'leave.submit_request',
    'leave.approve', 'leave.edit_balances', 'leave.archive',
    'people.view_own', 'people.edit_own', 'people.view_team', 'people.view_all',
    'people.edit_others', 'people.add_new', 'people.deactivate', 'people.assign_role',
    'sites.view_list', 'sites.view_details', 'sites.add', 'sites.edit', 'sites.archive',
    'sites.edit_lead',
    'app.view_own_profile', 'app.view_team_profiles', 'app.submit_feedback',
    'app.view_skills', 'app.edit_skills', 'app.manage_rotations', 'app.buddy_checkin',
    'app.view_engagement', 'app.quarterly_review',
    'reports.receive_digest', 'reports.subscribe_digest', 'reports.view_tenant_reports',
    'reports.export_data',
    'admin.view_config', 'admin.edit_config', 'admin.manage_roles', 'admin.invite_users',
    'admin.manage_billing', 'admin.view_audit_log'
  ],
  supervisor: [
    'roster.view_own', 'roster.view_team', 'roster.view_all', 'roster.request_changes',
    'roster.edit_team', 'roster.approve_changes',
    'ts.submit_own', 'ts.edit_own', 'ts.view_own', 'ts.view_team', 'ts.approve',
    'ts.send_reminders', 'ts.view_completion',
    'ph.view_dashboard', 'ph.tick_track_hours', 'ph.set_budget', 'ph.view_per_person',
    'leave.view_own_balance', 'leave.view_team_balances', 'leave.submit_request',
    'leave.approve', 'leave.archive',
    'people.view_own', 'people.edit_own', 'people.view_team',
    'sites.view_list', 'sites.view_details', 'sites.edit', 'sites.edit_lead',
    'app.view_team_profiles', 'app.view_skills', 'app.edit_skills',
    'app.manage_rotations', 'app.view_engagement', 'app.quarterly_review',
    'reports.receive_digest', 'reports.subscribe_digest', 'reports.view_tenant_reports'
  ],
  employee: [
    'roster.view_own', 'roster.view_team', 'roster.request_changes',
    'ts.submit_own', 'ts.edit_own', 'ts.view_own',
    'leave.view_own_balance', 'leave.submit_request',
    'people.view_own', 'people.edit_own', 'people.view_team',
    'sites.view_list', 'sites.view_details'
  ],
  apprentice: [
    'roster.view_own', 'roster.view_team', 'roster.request_changes',
    'ts.submit_own', 'ts.edit_own', 'ts.view_own',
    'leave.view_own_balance', 'leave.submit_request',
    'people.view_own', 'people.edit_own', 'people.view_team',
    'sites.view_list', 'sites.view_details',
    'app.view_own_profile', 'app.submit_feedback', 'app.view_skills', 'app.buddy_checkin'
  ],
  labour_hire: [
    'roster.view_own',
    'ts.submit_own', 'ts.view_own',
    'people.view_own',
    'sites.view_list'
  ]
};
