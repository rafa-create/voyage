import test from "node:test";
import assert from "node:assert/strict";
import {parsePublicStravaFeed,getPublicStravaWidgets} from "../worker/defi.js";

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

test("utilise les deux widgets fournis par le propriétaire sans configuration manuelle",async()=>{
  const widgets=await getPublicStravaWidgets({});
  assert.equal(widgets.feed,"https://www.strava.com/athletes/149399419/latest-rides/c85af98e34bbb4ad9d034058d986ba9dda5ae24f");
  assert.equal(widgets.summary,"https://www.strava.com/athletes/149399419/activity-summary/c85af98e34bbb4ad9d034058d986ba9dda5ae24f");
});
test("accepte les deux codes iframe Strava exacts",()=>{
  const feed="<iframe height='454' width='300' frameborder='0' allowtransparency='true' scrolling='no' src='https://www.strava.com/athletes/149399419/latest-rides/c85af98e34bbb4ad9d034058d986ba9dda5ae24f'></iframe>";
  const summary="<iframe height='160' width='300' frameborder='0' allowtransparency='true' scrolling='no' src='https://www.strava.com/athletes/149399419/activity-summary/c85af98e34bbb4ad9d034058d986ba9dda5ae24f'></iframe>";
  assert.equal(parsePublicStravaFeed(feed),"https://www.strava.com/athletes/149399419/latest-rides/c85af98e34bbb4ad9d034058d986ba9dda5ae24f");
  assert.equal(parsePublicStravaFeed(summary),"https://www.strava.com/athletes/149399419/activity-summary/c85af98e34bbb4ad9d034058d986ba9dda5ae24f");
});
