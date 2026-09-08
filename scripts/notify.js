/** Shared chat-whisper helpers used by both services.js and haggle.js —
 *  split out so neither needs to import the other (they're both imported
 *  by requests.js, which would otherwise create a cycle). */

export async function notifyGMs(content) {
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  return ChatMessage.create({ content, whisper: gmIds });
}

export async function notifyActorOwner(actor, content) {
  const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  if (!owners.length) return null;
  return ChatMessage.create({ content, whisper: owners });
}
