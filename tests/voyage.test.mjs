import test from "node:test";
import assert from "node:assert/strict";
import { matchStep, validDate, urlYoutube, legacyPhotos } from "../worker/content.js";

test("les dates du calendrier sont valides",()=>{
  assert.equal(validDate("2026-10-17"),true);
  assert.equal(validDate("2026-02-30"),false);
  assert.equal(validDate("2026-13-01"),false);
});
test("le classement respecte la date de prise de vue et non la date de dépôt",()=>{
  const steps=[
    {slug:"la-ciotat",date:"2026-10-17"},
    {slug:"tunis",date:"2026-10-20",dateFin:"2026-10-22"},
    {slug:"istanbul",date:"2026-10-23"}
  ];
  assert.equal(matchStep("2026-10-17",steps)?.slug,"la-ciotat");
  assert.equal(matchStep("2026-10-19",steps)?.slug,"la-ciotat");
  assert.equal(matchStep("2026-10-21",steps)?.slug,"tunis");
  assert.equal(matchStep("2026-10-23",steps)?.slug,"istanbul");
  assert.equal(matchStep(null,steps),null);
});
test("une date ambiguë entre deux étapes reste à classer",()=>{
  assert.equal(matchStep("2026-10-20",[
    {slug:"etape-1",date:"2026-10-20",dateFin:"2026-10-23"},
    {slug:"etape-2",date:"2026-10-20",dateFin:"2026-10-21"},
  ]),null);
});
test("validation des liens YouTube",()=>{
  assert.equal(urlYoutube("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),"dQw4w9WgXcQ");
  assert.equal(urlYoutube("https://youtu.be/dQw4w9WgXcQ"),"dQw4w9WgXcQ");
  assert.equal(urlYoutube("https://example.com/watch?v=dQw4w9WgXcQ"),null);
});
test("les anciennes photos publiques restent répertoriées",()=>{
  assert.ok(legacyPhotos().some(photo=>photo.key==="IMG_0240.jpeg"&&photo.etape==="la-ciotat"));
});
