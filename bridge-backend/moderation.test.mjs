// Run: node moderation.test.mjs
import { isNameAllowed, sanitizeName } from "./src/moderation.js";

let pass = 0, fail = 0;
const blk = (n) => { const ok = !isNameAllowed(n); ok ? pass++ : (fail++, console.log("FAIL block:", n)); };
const allow = (n) => { const ok = isNameAllowed(n); ok ? pass++ : (fail++, console.log("FAIL allow:", n)); };

// must block — english
["dickface", "fuckface", "shithead", "asshole", "cunt", "wanker", "bitch", "cockface",
 "shitlord", "assclown", "jackass", "xxx", "pornlord", "retardo", "n1gger", "fvck3r",
 "phuck", "b1tch", "rapist", "slutbag", "whore69"].forEach(blk);
// must block — other languages (present in dataset)
["cabron", "pendejo", "scheisse", "merde", "putain", "おっぱい", "アスホール", "ебать"].forEach(blk);
// must allow — innocent names incl. tricky ones (Scunthorpe problem)
["Cassandra", "Conrad", "Fanny", "Assassin", "Class", "Bassist",
 "Therapist", "Therapy", "Grape", "Drape", "Francesca", "Matsumoto", "Hiroshi", "Sakura",
 "Dmitri", "Ivan", "Pierre", "Hans", "Akira", "Sven", "Bjorn", "Vivi", "Vesper", "Avocado",
 "Emma", "Liam", "Olivia", "Noah", "Yuki", "Mohammed", "Fatima", "Carlos", "Giovanni"].forEach(allow);

// Documented ACCEPTABLE false-positives: real surnames that contain strong stems
// ("dick", "cock"). For a family-friendly game name we deliberately err safe and
// block these; the player can pick a variant. (Cockburn, Dickinson.)
["Cockburn", "Dickinson"].forEach(blk);

// replacement contract
const r = sanitizeName("dickface");
(r.changed && /^Child[0-9]{9}$/.test(r.name)) ? pass++ : (fail++, console.log("FAIL: bad name -> Child#########", r));
const ok = sanitizeName("Sakura");
(!ok.changed && ok.name === "Sakura") ? pass++ : (fail++, console.log("FAIL: clean name passthrough", ok));

console.log(`\nmoderation: PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
