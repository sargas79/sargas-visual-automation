/**
 * Natural attacks of creatures: strikes named after a body part (jaws, claws, stings, tails, wings, slams...).
 * Shared by the system adapters (which give them the "natural" weapon group) and the generic fallback (which
 * picks a bite/claw/slam animation sized and coloured by the creature).
 */

/** Weapon group reported for natural attacks. The PF2e vocabulary has none; "brawling" stays for fists. */
export const NATURAL_GROUP = "natural";

const FAMILIES = [
  { family: "bite", regex: /\b(jaws?|bites?|fangs?|beaks?|mandibles?|maw|teeth|tusks?)\b/i },
  { family: "claw", regex: /\b(claws?|talons?|pincers?|foreclaws?)\b/i },
  { family: "sting", regex: /\b(stings?|stingers?|barbs?|spines?)\b/i },
  {
    family: "slam",
    regex:
      /\b(tails?|horns?|hoo(?:f|ves)|slams?|tentacles?|tendrils?|wings?|trunks?|pseudopods?|vines?|branch(?:es)?|kicks?|stomps?|gores?|antlers?|body|legs?|foot|feet|headbutt|ram|tail slap)\b/i
  }
];

/**
 * Family ("bite", "claw", "sting", "slam") of a strike named after a body part, or null.
 * @param {...(string|null|undefined)} names  Names to test (base item slug, item name...).
 */
export function naturalFamilyOf(...names) {
  const list = names.filter((n) => typeof n === "string" && n).map((n) => n.replace(/-/g, " "));
  for (const { family, regex } of FAMILIES) {
    if (list.some((n) => regex.test(n))) return family;
  }
  return null;
}
