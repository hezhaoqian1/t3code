import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Move durable model selections to the canonical instance-owned shape.
 * Active request decoding is intentionally strict; compatibility for rows
 * written by migration 016 belongs at this immutable persistence boundary.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_projects
    SET default_model_selection_json = json_remove(
      json_set(
        default_model_selection_json,
        '$.instanceId',
        CASE
          WHEN json_type(default_model_selection_json, '$.instanceId') = 'text'
          THEN json_extract(default_model_selection_json, '$.instanceId')
          ELSE json_extract(default_model_selection_json, '$.provider')
        END
      ),
      '$.provider'
    )
    WHERE default_model_selection_json IS NOT NULL
      AND json_valid(default_model_selection_json)
      AND json_type(default_model_selection_json) = 'object'
      AND json_type(default_model_selection_json, '$.provider') = 'text'
  `;

  yield* sql`
    UPDATE projection_threads
    SET model_selection_json = json_remove(
      json_set(
        model_selection_json,
        '$.instanceId',
        CASE
          WHEN json_type(model_selection_json, '$.instanceId') = 'text'
          THEN json_extract(model_selection_json, '$.instanceId')
          ELSE json_extract(model_selection_json, '$.provider')
        END
      ),
      '$.provider'
    )
    WHERE model_selection_json IS NOT NULL
      AND json_valid(model_selection_json)
      AND json_type(model_selection_json) = 'object'
      AND json_type(model_selection_json, '$.provider') = 'text'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.modelSelection.instanceId',
        CASE
          WHEN json_type(payload_json, '$.modelSelection.instanceId') = 'text'
          THEN json_extract(payload_json, '$.modelSelection.instanceId')
          ELSE json_extract(payload_json, '$.modelSelection.provider')
        END
      ),
      '$.modelSelection.provider'
    )
    WHERE event_type IN (
      'thread.created',
      'thread.meta-updated',
      'thread.turn-start-requested'
    )
      AND json_valid(payload_json)
      AND json_type(payload_json, '$.modelSelection') = 'object'
      AND json_type(payload_json, '$.modelSelection.provider') = 'text'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.defaultModelSelection.instanceId',
        CASE
          WHEN json_type(payload_json, '$.defaultModelSelection.instanceId') = 'text'
          THEN json_extract(payload_json, '$.defaultModelSelection.instanceId')
          ELSE json_extract(payload_json, '$.defaultModelSelection.provider')
        END
      ),
      '$.defaultModelSelection.provider'
    )
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_valid(payload_json)
      AND json_type(payload_json, '$.defaultModelSelection') = 'object'
      AND json_type(payload_json, '$.defaultModelSelection.provider') = 'text'
  `;
});
