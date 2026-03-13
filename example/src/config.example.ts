/**
 * Configuration for the RiviumSync Example App
 *
 * Copy this file to config.ts and replace the values with your own
 * API key and database ID from the RiviumSync dashboard.
 *
 * cp src/config.example.ts src/config.ts
 */
export const AppConfig = {
  // Your RiviumSync Project API Key (get from RiviumSync dashboard > Projects)
  apiKey: 'YOUR_API_KEY_HERE',

  // Your database ID (create in RiviumSync console)
  databaseId: 'YOUR_DATABASE_ID_HERE',

  // Demo collection names
  todosCollection: 'todos',
  usersCollection: 'users',
  messagesCollection: 'messages',
};
