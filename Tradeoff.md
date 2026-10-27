# Swiss participant flexibility

Organizers may need to adjust participants and playoff fixtures to accommodate real-world competition changes. By product decision, this release does not add strict group-membership, playoff-eligibility, self-match, or repeated-team validation to Swiss confirmation endpoints.

Existing authorization, resource validation, pairing-conflict checks, and override behavior remain in place. Organizers are responsible for checking submitted fixtures. Incorrect selections can distort standings and qualification; automated qualification must be reviewed when custom fixtures differ from the proposed pairings.

This flexibility does not permit duplicate execution: round/playoff confirmations serialize their existence checks and inserts, and Swiss knockout generation is single-use per source stage. Knockout creation and seeding commit or roll back together. Existing duplicate knockout stages are preserved for manual review rather than deleted automatically.
