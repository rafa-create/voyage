import test from "node:test";
import assert from "node:assert/strict";
import {summarizeChallenge,normalizeChessGame} from "../worker/defi.js";

const config={debut:"2026-10-15",chessUsername:"rafaelorset",timezone:"Europe/Paris"};
test("la dernière partie de chaque date prend priorité, même après une victoire",()=>{
  const chess={games:[
    {date:"2026-10-17",result:"Victoire",fin:1792231000,url:"https://www.chess.com/game/1",mode:"rapid",rating:705},
    {date:"2026-10-17",result:"Défaite",fin:1792241000,url:"https://www.chess.com/game/2",mode:"rapid",rating:698},
    {date:"2026-10-16",result:"Nulle",fin:1792150000,url:"https://www.chess.com/game/3",mode:"rapid",rating:700}
  ],ratingStats:{rapid:698}};
  const s=summarizeChallenge(config,chess,[],"2026-10-17");
  assert.equal(s.jours[0].echecs.result,"Défaite");
  assert.equal(s.jours[0].echecs.fin,1792241000);
  assert.equal(s.stats.joursEchecs,2);
  assert.equal(s.elo.mode,"rapid");
  assert.equal(s.elo.rating,698);
  assert.equal(s.elo.delta,-7);
});
test("une seule course est retenue par jour et une saisie manuelle ne masque pas la course Strava",()=>{
  const runs=[
    {date:"2026-10-17",id:"1",source:"strava",fin:120000,km:3.3,url:"https://www.strava.com/activities/1"},
    {date:"2026-10-17",id:"2",source:"strava",fin:140000,km:5.7,url:"https://www.strava.com/activities/2"},
    {date:"2026-10-17",ajouteLe:"2026-10-17T21:00:00Z",km:10,url:"https://www.strava.com/activities/3"}
  ];
  const s=summarizeChallenge(config,{games:[]},runs,"2026-10-17");
  assert.equal(s.jours[0].activite.id,"2");
  assert.equal(s.jours[0].activite.kmTotal,5.7);
  assert.equal(s.stats.joursActivites,1);
});
test("les objectifs du jour ne sont validés qu'avec les deux activités",()=>{
  const game={date:"2026-10-17",result:"Victoire",fin:1792241000,url:"https://www.chess.com/game/2"};
  const run={date:"2026-10-17",id:"1",source:"strava",fin:145000,km:6,url:"https://www.strava.com/activities/1"};
  const waiting=summarizeChallenge(config,{games:[game]},[],"2026-10-17");
  assert.equal(waiting.jours[0].resultat,"en_cours");
  const complete=summarizeChallenge(config,{games:[game]},[run],"2026-10-17");
  assert.equal(complete.jours[0].resultat,"reussi");
});
test("la cadence Elo est conservée et les parties non classées n'inventent pas de classement",()=>{
  const parsed=normalizeChessGame({
    end_time:1792241000,url:"https://www.chess.com/game/2",time_class:"rapid",
    white:{username:"rafaelorset",rating:701,result:"win"},
    black:{username:"adversaire",rating:760,result:"checkmated"}
  },"rafaelorset","Europe/Paris");
  assert.equal(parsed?.rating,701);
  assert.equal(parsed?.mode,"rapid");
  const noRating=normalizeChessGame({
    end_time:1792241000,url:"https://www.chess.com/game/3",time_class:"blitz",
    white:{username:"rafaelorset",result:"win"},black:{username:"adversaire",result:"checkmated"}
  },"rafaelorset","Europe/Paris");
  assert.equal(noRating.rating,null);
});
