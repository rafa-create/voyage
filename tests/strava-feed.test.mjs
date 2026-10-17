import test from "node:test";
import assert from "node:assert/strict";
import {parsePublicStravaFeed} from "../worker/defi.js";

test("accepte le widget officiel des dernières activités Strava",()=>{
  assert.equal(parsePublicStravaFeed('https://www.strava.com/athletes/123/latest-rides/abc123'),
    'https://www.strava.com/athletes/123/latest-rides/abc123');
  assert.equal(parsePublicStravaFeed('<iframe src="https://www.strava.com/athletes/123/activity-summary/abc123"></iframe>'),
    'https://www.strava.com/athletes/123/activity-summary/abc123');
});
test("refuse les activités individuelles, les sites tiers et le HTML arbitraire",()=>{
  assert.equal(parsePublicStravaFeed('https://www.strava.com/activities/12345678'),null);
  assert.equal(parsePublicStravaFeed('<iframe src="https://example.com/athletes/123/latest-rides/a"></iframe>'),null);
  assert.equal(parsePublicStravaFeed('<script>alert(1)</script>'),null);
  assert.equal(parsePublicStravaFeed(''),"");
});
