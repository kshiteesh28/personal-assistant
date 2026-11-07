/**
 * test-notifications.ts
 * Manual test runner for all OS notification types.
 * Run with: bun scripts/test-notifications.ts
 */

// node-notifier uses dynamic require internally but we can call it via Bun
// Using any cast since @types/node-notifier may not be installed
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifier = require('node-notifier') as {
  notify: (opts: { title: string; message: string; subtitle?: string; sound?: boolean; wait?: boolean }) => void;
};

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function testNotification(title: string, message: string, subtitle?: string): Promise<void> {
  console.log(`\n[TEST] ${title}: "${message}"`);
  notifier.notify({ title, message, subtitle, sound: true, wait: false });
  await wait(2000);
}

async function main(): Promise<void> {
  console.log('=== Personal Secretary — Notification Test ===\n');
  console.log('Testing all notification types with 2-second gaps...\n');

  await testNotification('📋 Daily Brief Ready',   'Your morning brief has been generated.',     'Personal Secretary');
  await testNotification('⏰ Reminder Due',          'Call dentist — scheduled for now',            'Personal Secretary');
  await testNotification('📅 Meeting Approaching', 'Weekly Standup starts in 5 minutes',          'Personal Secretary');
  await testNotification('💧 Wellness Nudge',       'Time to hydrate! Drink a glass of water.',   'Personal Secretary');
  await testNotification('☕ Break Time',            "Great work! Take a 5-minute break.",          'Personal Secretary');
  await testNotification('⚡ Motivation',            "You've got this! Keep up the great work.",   'Personal Secretary');
  await testNotification('📌 Task Deadline',        'Design mockups is due in 5 minutes!',        'Personal Secretary');

  console.log('\n=== All 7 notifications sent! ===');
  console.log('If none appeared, ensure node-notifier is installed and Windows notifications are enabled.');
}

main().catch(console.error);
