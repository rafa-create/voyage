import test from "node:test";
import assert from "node:assert/strict";
import {privateStravaFetch} from "../worker/strava-bridge.js";

test("le pont Strava ne peut pas contacter BeatOnStep sans clé privée",async()=>{
  const result=await privateStravaFetch({},"activities");
  assert.equal(result.status,503);
  assert.match(result.body.error,/VOYAGE_BRIDGE_KEY/);
});
test("le pont refuse les actions et identifiants hors liste autorisée",async()=>{
  const env={VOYAGE_BRIDGE_KEY:"a".repeat(48)};
  for(const action of ["../../../secret","activities/evil/route","activities/0/route"]){
    const result=await privateStravaFetch(env,action);
    assert.equal(result.status,400);
  }
});
