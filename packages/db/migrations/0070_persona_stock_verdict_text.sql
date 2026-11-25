WITH corrected AS (
	UPDATE "pages"
	SET
		"body_md" = replace(
			replace(
				"body_md",
				'End your scout with a fenced `harness-scout` block naming `premise` (`holds` or `does_not_hold`) and a one-line `reason`.',
				'Open your scout answer with a fenced `harness-scout` block, and nothing before it, naming `premise` (`holds`, or `held` when the item should not be worked as written) and a one-line `reason`.'
			),
			'End your review with a fenced `harness-verdict` block naming `verdict` (`approve` or `request_changes`).',
			'Open your review with a fenced `harness-verdict` block, and nothing before it, naming `verdict` (`approve` or `request_changes`).'
		),
		"version" = "version" + 1,
		"updated_at" = now()
	WHERE "type" = 'persona'
		AND (
			strpos("body_md", 'End your scout with a fenced `harness-scout` block naming `premise` (`holds` or `does_not_hold`) and a one-line `reason`.') > 0
			OR strpos("body_md", 'End your review with a fenced `harness-verdict` block naming `verdict` (`approve` or `request_changes`).') > 0
		)
	RETURNING "id", "version", "type", "jd_area", "slug", "title", "parent_id", "frontmatter", "body_md", "status"
)
INSERT INTO "page_versions" ("page_id", "version", "type", "jd_area", "slug", "title", "parent_id", "frontmatter", "body_md", "status", "edit_source")
SELECT "id", "version", "type", "jd_area", "slug", "title", "parent_id", "frontmatter", "body_md", "status", 'agent:system'
FROM corrected;
