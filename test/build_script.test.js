// node test/build_script.test.js
const assert = require("assert");
const { build } = require("../tools/build_script.js");
const L = (speaker, text) => ({ speaker, scene: "s", text });
let s = build([L("a", "one"), L("a", "two"), L("b", "three")], [], []);
assert.deepStrictEqual(s.map((x) => x.id), ["a-01", "a-02", "b-01"], "fresh ids count per speaker");
// same words keep their id even when the order changes
let s2 = build([L("b", "three"), L("a", "two"), L("a", "one")], s, []);
assert.strictEqual(s2.find((x) => x.text === "one").id, "a-01", "ids are pinned to their words");
// new words: a new id, and the old one retires
let s3 = build([L("a", "one!"), L("a", "two"), L("b", "three")], s2, []);
assert.strictEqual(s3.find((x) => x.text === "one!").id, "a-03", "changed words get a new id");
assert.ok(s3.find((x) => x.id === "a-01").retired, "and the old id is retired, not reused");
// reworded.json keeps the id on purpose
let s4 = build([L("a", "one!"), L("a", "two"), L("b", "three")], s2, [{ id: "a-01", text: "one!" }]);
assert.strictEqual(s4.find((x) => x.text === "one!").id, "a-01", "a listed rewording keeps its id");
assert.ok(!s4.some((x) => x.retired), "and nothing is retired");
// the same words twice are one line
assert.strictEqual(build([L("a", "x"), L("a", "x")], [], []).length, 1, "repeats collapse");
console.log("build_script: all pass");
