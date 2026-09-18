// backend/scripts/seedDemoData.js
//
// Manages the "Try Demo Account" feature's data. Exports resetDemoData(),
// called from authRoutes.js's /login route whenever the DEMO account logs
// in — this is what keeps the demo in a clean, realistic state without
// needing a scheduled job (see the reasoning in the PR/commit message:
// Render's free tier spins down on inactivity, so a fixed-time cron isn't
// reliable here — resetting exactly when someone opens the demo is).
//
// Also runnable standalone for initial setup:
//   node scripts/seedDemoData.js
//
// SAFETY: this only ever touches data OWNED BY the demo account (its own
// cases, messages, notifications) and a small set of companion "demo
// lawyer" accounts identified by a fixed, reserved email pattern. It never
// touches real users' data.

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/User.js";
import Case from "../src/models/Case.js";
import Message from "../src/models/Message.js";
import Notification from "../src/models/Notification.js";
import { getEmbedding } from "../src/utils/embeddingService.js";

dotenv.config();

const DEMO_EMAIL    = process.env.DEMO_EMAIL    || "demo@lawhelpzone.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";

// Reserved, fixed emails for the companion lawyer profiles that populate
// the demo's proposals/messages. Deterministic so re-running the reset
// reuses the same accounts instead of creating duplicates every time.
const DEMO_LAWYERS = [
  {
    email: "demo-lawyer-1@lawhelpzone-demo.local",
    name: "Ayesha Raza",
    bio: "Family law specialist with 9 years of experience handling divorce, custody, and domestic violence cases across Pakistan. Known for a compassionate, client-first approach.",
    specializations: ["Family Law"],
    jurisdiction: "Lahore, Pakistan",
    rating: 4.8,
  },
  {
    email: "demo-lawyer-2@lawhelpzone-demo.local",
    name: "Bilal Ahmed",
    bio: "Corporate and contract law advisor for startups and SMEs. Experienced in business registration, shareholder agreements, and commercial disputes.",
    specializations: ["Corporate Law", "Contract Law", "Business Law"],
    jurisdiction: "Karachi, Pakistan",
    rating: 4.6,
  },
  {
    email: "demo-lawyer-3@lawhelpzone-demo.local",
    name: "Hina Malik",
    bio: "Real estate and tenancy law practitioner. Handles property disputes, lease agreements, and landlord-tenant conflicts.",
    specializations: ["Real Estate Law"],
    jurisdiction: "Islamabad, Pakistan",
    rating: 4.9,
  },
];

const DEMO_CASE_TEMPLATES = [
  { title: "Landlord refusing to return security deposit after move-out", category: "Real Estate Law", urgency: "medium",
    description: "I moved out of my rented apartment three months ago after giving proper notice, but my landlord is refusing to return my security deposit of PKR 80,000. He claims there is damage to the property, but I have photos from move-out day showing everything was in good condition. I need advice on how to formally demand the deposit and what legal action I can take if he continues to refuse." },
  { title: "Seeking divorce due to ongoing domestic violence", category: "Family Law", urgency: "urgent",
    description: "I want to file for divorce from my husband due to repeated domestic violence over the past two years. I have some documentation including medical reports from hospital visits. I need to understand the process for filing, whether I can get a protective order, and how child custody would typically be handled in a case like mine." },
  { title: "Wrongful termination without notice or severance", category: "Employment Law", urgency: "high",
    description: "I was terminated from my job of 5 years without any prior warning, notice period, or severance pay. My employment contract states a 30-day notice period is required. I want to understand my legal options for claiming compensation and whether this counts as wrongful termination under labor law." },
  { title: "Business partner withdrawing funds without consent", category: "Corporate Law", urgency: "urgent",
    description: "My business partner has been withdrawing company funds from our joint business account without my knowledge or consent, totaling approximately PKR 500,000 over the last few months. We have a 50/50 partnership agreement. I need to understand how to legally address this, freeze the account if possible, and pursue recovery of the funds." },
  { title: "Trademark infringement by a competitor", category: "Intellectual Property", urgency: "medium",
    description: "A competing business has started using a logo and brand name that is nearly identical to mine, which I have been using for 3 years and have a pending trademark application for. Customers are getting confused between the two businesses. I need advice on sending a cease and desist letter and my options for legal action." },
  { title: "Immigration visa application rejected without clear reason", category: "Immigration Law", urgency: "high",
    description: "My spouse visa application was rejected and the rejection letter only cites 'insufficient documentation' without specifying what was missing. We submitted all the documents on the checklist. I need help understanding the appeal process and what additional evidence might strengthen our case." },
  { title: "Neighbor's construction encroaching on my property boundary", category: "Real Estate Law", urgency: "medium",
    description: "My neighbor started construction on what I believe is a shared boundary wall, extending about 2 feet into what should be my property based on the original survey documents I have. I've tried discussing this directly but they insist they're within their rights. I need to understand how to get an official boundary survey and what legal steps follow if encroachment is confirmed." },
  { title: "Contract dispute over unpaid freelance work", category: "Contract Law", urgency: "medium",
    description: "I completed a 3-month freelance web development project for a client based on a signed contract, but they are refusing to pay the final invoice of PKR 250,000, citing vague dissatisfaction with minor details not mentioned in our original scope. I have all project communications and the signed contract. I want to know my options for recovering payment." },
  { title: "Criminal charges filed after a workplace altercation", category: "Criminal Law", urgency: "urgent",
    description: "I was involved in a verbal altercation with a coworker that escalated, and they have now filed a police complaint against me alleging assault, which I deny. I have not been formally charged yet but have been asked to appear for questioning. I need representation to understand my rights and prepare for this process." },
  { title: "Disputed tax assessment from FBR", category: "Tax Law", urgency: "medium",
    description: "I received a tax assessment notice claiming I owe significantly more than what I calculated and filed for the last fiscal year, with a discrepancy of about PKR 300,000. I believe there's an error in how my deductions were processed. I need guidance on filing an appeal and what documentation I should prepare." },
];

async function findOrCreateDemoUser() {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({
      name: "Demo User",
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD, // hashed automatically by the User model's pre-save hook
      role: "client",
      emailVerified: true, // skip the verification nag banner for demo visitors
    });
    console.log(`Created demo user: ${DEMO_EMAIL}`);
  }
  return user;
}

async function findOrCreateDemoLawyers() {
  const lawyers = [];
  for (const l of DEMO_LAWYERS) {
    let lawyer = await User.findOne({ email: l.email });
    if (!lawyer) {
      // Companion accounts use a random password — nobody is meant to log
      // into these directly, they exist only to populate realistic
      // proposals/messages on the demo client's cases.
      lawyer = await User.create({
        name: l.name,
        email: l.email,
        password: `unused-${Math.random().toString(36).slice(2)}`,
        role: "lawyer",
        emailVerified: true,
        lawyerProfile: {
          bio: l.bio,
          specializations: l.specializations,
          jurisdiction: l.jurisdiction,
          rating: l.rating,
        },
      });
      // Background embedding for the bio, same as a real lawyer signup —
      // keeps semanticSearchLawyers demo-able too. Non-blocking.
      getEmbedding(l.bio)
        .then((embedding) => {
          if (embedding) return User.findByIdAndUpdate(lawyer._id, { "lawyerProfile.bioEmbedding": embedding });
        })
        .catch((err) => console.error("Demo lawyer bio embedding failed:", err.message));
    }
    lawyers.push(lawyer);
  }
  return lawyers;
}

function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

export async function resetDemoData() {
  const demoUser = await findOrCreateDemoUser();
  const demoLawyers = await findOrCreateDemoLawyers();

  // Wipe only the demo user's own data — never touches real users.
  await Case.deleteMany({ clientId: demoUser._id });
  await Message.deleteMany({ $or: [{ senderId: demoUser._id }, { receiverId: demoUser._id }] });
  await Notification.deleteMany({ userId: demoUser._id });

  // Recreate cases (title/description vary by template; budget/deadline randomized for realism)
  const createdCases = [];
  for (let i = 0; i < DEMO_CASE_TEMPLATES.length; i++) {
    const t = DEMO_CASE_TEMPLATES[i];
    const hasProposals = i % 3 !== 2; // most cases get proposals, a few stay untouched
    const proposals = hasProposals
      ? [demoLawyers[i % demoLawyers.length]].map((lawyer) => ({
          lawyerId: lawyer._id,
          message: `Hello, I've reviewed your case and I have relevant experience with similar matters. I'd be glad to discuss further and help you resolve this.`,
          fee: 15000 + i * 2500,
          proposedBudget: 40000 + i * 5000,
          proposedDeadline: futureDate(20 + i),
          status: i % 4 === 0 ? "accepted" : "pending",
        }))
      : [];

    const newCase = await Case.create({
      title: t.title,
      description: t.description,
      category: t.category,
      location: "Lahore",
      country: "Pakistan",
      budget: 40000 + i * 5000,
      deadline: futureDate(25 + i * 2),
      urgency: t.urgency,
      status: i % 5 === 0 ? "in-progress" : "open",
      clientId: demoUser._id,
      assignedLawyerId: i % 5 === 0 ? demoLawyers[i % demoLawyers.length]._id : null,
      proposals,
    });
    createdCases.push(newCase);

    // Background embedding, same as real case creation — non-blocking.
    getEmbedding(`${t.title}\n${t.description}`)
      .then((embedding) => {
        if (embedding) return Case.findByIdAndUpdate(newCase._id, { embedding });
      })
      .catch((err) => console.error("Demo case embedding failed:", err.message));
  }

  // A short realistic conversation with one of the lawyers
  const chatLawyer = demoLawyers[0];
  const conversation = [
    { from: "lawyer", text: "Hi! I saw your case about the security deposit dispute. I've handled several similar cases — happy to help." },
    { from: "demo",   text: "Thank you for reaching out. What would be the first step you'd recommend?" },
    { from: "lawyer", text: "I'd start with a formal written demand letter citing the relevant tenancy law. If that doesn't work, we can escalate to a civil claim." },
    { from: "demo",   text: "That sounds good. Do you need the move-out photos I mentioned?" },
    { from: "lawyer", text: "Yes, please share those along with the original lease agreement when you get a chance." },
  ];
  for (const m of conversation) {
    await Message.create({
      senderId:   m.from === "demo" ? demoUser._id : chatLawyer._id,
      receiverId: m.from === "demo" ? chatLawyer._id : demoUser._id,
      content:    m.text,
      type:       "text",
      read:       true,
    });
  }

  // A few notifications so that page isn't empty either
  await Notification.create([
    { userId: demoUser._id, type: "new_proposal", title: "New Proposal Received", message: `${demoLawyers[0].name} sent you a proposal.`, read: false },
    { userId: demoUser._id, type: "message", title: "New Message", message: `${demoLawyers[0].name} sent you a message.`, read: false },
    { userId: demoUser._id, type: "case_update", title: "Case Status Updated", message: "One of your cases moved to In Progress.", read: true },
  ]);

  console.log(`Demo data reset: ${createdCases.length} cases, ${conversation.length} messages, 3 notifications`);
  return { caseCount: createdCases.length };
}

// Allow running standalone: node scripts/seedDemoData.js
if (import.meta.url === `file://${process.argv[1]}`) {
  mongoose.connect(process.env.MONGO_URI, { dbName: "lawhelpzone" })
    .then(async () => {
      console.log("Connected. Seeding demo data...");
      await resetDemoData();
      await mongoose.disconnect();
      console.log("Done.");
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}