/**
 * Athena DB Protection Hook
 * Blocks dangerous database operations that could wipe your data.
 * Runs automatically before every Bash command Claude executes.
 */

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(chunks.join(''));
    const cmd = ((input.tool_input || {}).command || '').toLowerCase();

    const dangerous = [
      'prisma migrate reset',   // Wipes entire database
      'drop table',             // Deletes a table
      'drop database',          // Deletes entire database
      'truncate table',         // Deletes all rows in a table
      'delete from',            // Mass delete (no WHERE clause check)
    ];

    const matched = dangerous.find(pattern => cmd.includes(pattern));

    if (matched) {
      process.stderr.write(
        '\n[BLOCKED] Dangerous database operation detected: "' + matched + '"\n' +
        'This could permanently delete your data.\n' +
        'If you really need to do this, run it manually in your terminal.\n\n'
      );
      process.exit(2);
    }
  } catch (e) {
    // If we can't parse input, allow the command through
  }
  process.exit(0);
});
