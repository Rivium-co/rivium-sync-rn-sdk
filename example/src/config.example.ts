/**
 * Configuration for the RiviumSync Example App
 *
 * Copy this file to config.ts (git ignores it) and fill in your own values:
 *
 * cp src/config.example.ts src/config.ts
 */
export const AppConfig = {
  // Your Rivium project's API key (Rivium Console > Project settings).
  apiKey: 'YOUR_API_KEY_HERE',

  // Your database NAME as shown in Rivium Console (not its UUID).
  // Realtime updates are published by name, so live updates only arrive
  // when you use the name.
  databaseName: 'my-app',

  // DEBUG ONLY: the project's server secret (rv_srv_...), so the demo token
  // minter (src/demoUser.ts) can sign user tokens without a backend. It is
  // only read in development builds (__DEV__). Never put a server secret in a
  // real app: mint tokens on your own server. Leave '' to run without tokens.
  serverSecret: '',

  // The user the demo signs tokens for; "Switch user" on the Rules screen
  // signs in as `${demoUserId}-2`.
  demoUserId: 'rn-demo-user',

  // Leave ''.
  emulatorHost: '',

  // Demo collection names
  todosCollection: 'todos',
  usersCollection: 'users',
  messagesCollection: 'messages',
};
