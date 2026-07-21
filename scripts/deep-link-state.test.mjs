import assert from "node:assert/strict";
import test from "node:test";

import {
  commandPageDeepLink,
  resolveFilterDeepLink,
  skinCategoryDeepLink,
  skinWeaponDeepLink
} from "../assets/js/deep-link-state.mjs";

test("resolves canonical skin category links", () => {
  assert.deepEqual(resolveFilterDeepLink("#skins-human"), {
    tab: "skins",
    skinCategory: "human"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-zombie"), {
    tab: "skins",
    skinCategory: "zombie"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-weapon"), {
    tab: "skins",
    skinCategory: "weapon"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-spray"), {
    tab: "skins",
    skinCategory: "spray"
  });
});

test("resolves weapon category links", () => {
  assert.deepEqual(resolveFilterDeepLink("#skins-weapon-primary"), {
    tab: "skins",
    skinCategory: "weapon",
    skinWeapon: "primary"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-weapon-secondary"), {
    tab: "skins",
    skinCategory: "weapon",
    skinWeapon: "secondary"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-weapon-melee"), {
    tab: "skins",
    skinCategory: "weapon",
    skinWeapon: "melee"
  });
  assert.deepEqual(resolveFilterDeepLink("#skins-weapon-throwable"), {
    tab: "skins",
    skinCategory: "weapon",
    skinWeapon: "throwable"
  });
});

test("resolves canonical command links", () => {
  assert.deepEqual(resolveFilterDeepLink("#commands"), {
    tab: "cmds",
    commandPage: "all"
  });
  assert.deepEqual(resolveFilterDeepLink("#commands-donator"), {
    tab: "cmds",
    commandPage: "donator"
  });
});

test("does not consume legacy or item links", () => {
  assert.equal(resolveFilterDeepLink("#skins"), null);
  assert.equal(resolveFilterDeepLink("#cmds"), null);
  assert.equal(resolveFilterDeepLink("#skin-zombie"), null);
  assert.equal(resolveFilterDeepLink("#command-hide"), null);
});

test("builds only the requested canonical links", () => {
  assert.equal(skinCategoryDeepLink("zombie"), "skins-zombie");
  assert.equal(skinCategoryDeepLink("spray"), "skins-spray");
  assert.equal(skinCategoryDeepLink("unknown"), null);
  assert.equal(skinWeaponDeepLink("primary"), "skins-weapon-primary");
  assert.equal(skinWeaponDeepLink("throwable"), "skins-weapon-throwable");
  assert.equal(skinWeaponDeepLink("unknown"), null);
  assert.equal(commandPageDeepLink("all"), "commands");
  assert.equal(commandPageDeepLink("donator"), "commands-donator");
  assert.equal(commandPageDeepLink("server"), "cmds");
});
