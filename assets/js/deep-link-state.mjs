const FILTER_LINKS = new Map([
  ["skins-human", { tab: "skins", skinCategory: "human" }],
  ["skins-zombie", { tab: "skins", skinCategory: "zombie" }],
  ["skins-weapon", { tab: "skins", skinCategory: "weapon" }],
  ["skins-weapon-primary", { tab: "skins", skinCategory: "weapon", skinWeapon: "primary" }],
  ["skins-weapon-secondary", { tab: "skins", skinCategory: "weapon", skinWeapon: "secondary" }],
  ["skins-weapon-melee", { tab: "skins", skinCategory: "weapon", skinWeapon: "melee" }],
  ["skins-weapon-throwable", { tab: "skins", skinCategory: "weapon", skinWeapon: "throwable" }],
  ["skins-spray", { tab: "skins", skinCategory: "spray" }],
  ["commands", { tab: "cmds", commandPage: "all" }],
  ["commands-donator", { tab: "cmds", commandPage: "donator" }]
]);

export function resolveFilterDeepLink(value) {
  const hash = decodeURIComponent(String(value || "").replace(/^#/, ""));
  const state = FILTER_LINKS.get(hash);
  return state ? { ...state } : null;
}

export function skinCategoryDeepLink(category) {
  return ["human", "zombie", "weapon", "spray"].includes(category)
    ? `skins-${category}`
    : null;
}

export function skinWeaponDeepLink(weapon) {
  return ["primary", "secondary", "melee", "throwable"].includes(weapon)
    ? `skins-weapon-${weapon}`
    : null;
}

export function commandPageDeepLink(pageId) {
  if (pageId === "all") return "commands";
  if (pageId === "donator") return "commands-donator";
  return "cmds";
}
