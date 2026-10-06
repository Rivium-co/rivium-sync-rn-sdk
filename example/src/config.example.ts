/**
 * Configuration for the RiviumSync Example App
 *
 * Copy this file to config.ts and replace the values with your own
 * API key and database name from the RiviumSync dashboard.
 *
 * cp src/config.example.ts src/config.ts
 */
export const AppConfig = {
  // Your RiviumSync Project API Key (get from RiviumSync dashboard > Projects)
  apiKey: 'YOUR_API_KEY_HERE',

  // Your database NAME as shown in Rivium Console (not its UUID).
  // Realtime updates are published by name, so live updates only arrive
  // when you use the name.
  databaseName: 'my-app',

  // Demo collection names
  todosCollection: 'todos',
  usersCollection: 'users',
  messagesCollection: 'messages',
};
