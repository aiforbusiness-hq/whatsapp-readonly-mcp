// Made-up chats for the benchmark. No real people or messages.
// `me` marks messages the user sent. Times are minutes before "now".
export const CHATS = [
  { id: "60111000001@c.us", name: "Aisha Rahman", unread: 2, msgs: [
    { me: 0, ago: 2900, text: "Hi, I want to book the AI class for December" },
    { me: 1, ago: 2880, text: "Sure! Deposit RM500 holds your seat" },
    { me: 0, ago: 125, text: "I transferred the RM500 deposit just now" },
    { me: 0, ago: 120, text: "Can you confirm my seat?" }] },
  { id: "60111000002@c.us", name: "Jason Lim", unread: 1, msgs: [
    { me: 1, ago: 1500, text: "Your order is packed" },
    { me: 0, ago: 190, text: "Can I collect the goods tomorrow morning?" }] },
  { id: "60111000003@c.us", name: "Kak Ros", unread: 1, msgs: [
    { me: 1, ago: 4000, text: "Barang sudah pos ya" },
    { me: 0, ago: 300, text: "Bila barang saya sampai?" }] },
  { id: "60111000004@c.us", name: "Mr Tan", unread: 0, msgs: [
    { me: 0, ago: 600, text: "How much for the 3-month course?" },
    { me: 1, ago: 590, text: "RM3,800, group of 4 gets 10% off" }] },
  { id: "120363000000000001@g.us", name: "Parents 4B", group: true, unread: 6, msgs: [
    { me: 0, ago: 480, by: "Teacher Lee", text: "Field trip to the zoo moves to Friday 5 December" },
    { me: 0, ago: 478, by: "Teacher Lee", text: "Please bring RM15 and a packed lunch" },
    { me: 0, ago: 470, by: "Mei Ling", text: "Can the kids bring water bottles?" },
    { me: 0, ago: 465, by: "Teacher Lee", text: "Yes, and please wear sports attire" },
    { me: 0, ago: 400, by: "Raj", text: "Bus leaves school at 8am sharp?" },
    { me: 0, ago: 395, by: "Teacher Lee", text: "Yes 8am, be at the hall by 7.45am" }] },
  { id: "60111000006@c.us", name: "Ah Seng Trading", unread: 0, msgs: [
    { me: 0, ago: 2000, text: "Boss, invoice INV-20931 for the November stock is RM2,460" },
    { me: 0, ago: 1995, text: "Due by 10 December" },
    { me: 1, ago: 1900, text: "Noted, will pay this week" }] },
  { id: "60111000007@c.us", name: "Mum", unread: 0, msgs: [
    { me: 0, ago: 1440, text: "Dinner on Sunday?" }, { me: 1, ago: 1430, text: "Yes, see you" }] },
  { id: "60111000008@c.us", name: "Daniel Wong", unread: 0, msgs: [
    { me: 0, ago: 3000, text: "Thanks for the slides" }, { me: 1, ago: 2990, text: "Welcome!" }] },
  { id: "120363000000000002@g.us", name: "AI Class Alumni", group: true, unread: 0, msgs: [
    { me: 0, ago: 5000, by: "Siti", text: "Thanks for the session today" }, { me: 1, ago: 4990, text: "Glad it helped!" }] },
  { id: "60111000010@c.us", name: "Grab Driver", unread: 0, msgs: [
    { me: 0, ago: 6000, text: "I am downstairs" }, { me: 1, ago: 5995, text: "Coming" }] },
  { id: "60111000011@c.us", name: "Priya", unread: 0, msgs: [
    { me: 0, ago: 7000, text: "Can share the deck?" }, { me: 1, ago: 6990, text: "Sent to your email" }] },
  { id: "60111000012@c.us", name: "Landlord", unread: 0, msgs: [
    { me: 0, ago: 9000, text: "Rent reminder for December" }, { me: 1, ago: 8990, text: "Paid, thanks" }] }
];

// The three questions, and how to check an answer (case-insensitive).
export const TASKS = [
  { id: "waiting", prompt: "Who is waiting for my reply on WhatsApp? Just list their names.",
    check: (a) => ["aisha", "jason", "ros"].every((n) => a.includes(n)) && !a.includes("mr tan") },
  { id: "group-summary", prompt: "Summarise what the WhatsApp group Parents 4B talked about, in 3 short bullet points.",
    check: (a) => a.includes("friday") && (a.includes("rm15") || a.includes("rm 15")) && a.includes("8") },
  { id: "find-invoice", prompt: "Find the WhatsApp message with an invoice number. Who sent it, and what is the invoice number and amount?",
    check: (a) => a.includes("inv-20931") && a.includes("ah seng") && (a.includes("2,460") || a.includes("2460")) }
];
