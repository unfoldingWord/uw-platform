ALTER TABLE "probes" ADD CONSTRAINT "probes_stage_known" CHECK ("stage" IN ('build', 'merge', 'ship'));
