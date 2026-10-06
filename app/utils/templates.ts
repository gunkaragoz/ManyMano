// Starter templates for the create forms, and the content of their public
// pages (/templates and /templates/<slug>).
//
// Each template is a prefill in the normalized, relative shape from
// ~/utils/prefill — dates are "next Monday", "tomorrow", never a fixed day —
// so the create page resolves it against today like any copy. Copy stays
// generic: no school, team, or business names, only placeholders.
import type {
  PollPrefill,
  RelativeAnchor,
  RelativeDayFilter,
  SignupPrefill,
} from "~/utils/prefill";
import { formatDurationLabel } from "~/utils/calendar";
import { formatTimeDisplay } from "~/utils/pollTitles";

export type TemplateCategory = "school" | "fundraising" | "community" | "sports" | "social" | "work";

export const TEMPLATE_CATEGORIES: Array<{ key: TemplateCategory; label: string }> = [
  { key: "school", label: "School" },
  { key: "fundraising", label: "Fundraising" },
  { key: "community", label: "Community" },
  { key: "sports", label: "Sports" },
  { key: "social", label: "Social" },
  { key: "work", label: "Work" },
];

/** Icon keys the template pages know how to draw. */
export type TemplateIcon =
  | "heart"
  | "book"
  | "school"
  | "utensils"
  | "party"
  | "cake"
  | "popcorn"
  | "droplets"
  | "soup"
  | "briefcase"
  | "book-open"
  | "trophy"
  | "dice"
  | "wine"
  | "beer"
  | "presentation"
  | "house"
  | "tent"
  | "music"
  | "sandwich"
  | "backpack"
  | "film"
  | "bike"
  | "globe"
  | "drumstick"
  | "star"
  | "flask"
  | "cookie"
  | "bingo"
  | "medal"
  | "piggy-bank"
  | "restaurant"
  | "folder";

type TemplateBase = {
  slug: string;
  /** Card and breadcrumb name. */
  name: string;
  /** One line under the name on cards. */
  tagline: string;
  category: TemplateCategory;
  icon: TemplateIcon;
  seo: {
    /** <title> without the brand suffix. */
    title: string;
    description: string;
    h1: string;
    intro: string[];
    tips: string[];
    faqs: Array<{ question: string; answer: string }>;
  };
};

export type SignupTemplate = TemplateBase & {
  type: "SIGNUP_SHEET";
  prefill: Omit<SignupPrefill, "source">;
};

export type PollTemplate = TemplateBase & {
  type: "TIME_POLL";
  poll: {
    title: string;
    description: string;
    anchor: Exclude<RelativeAnchor, { kind: "undated" }>;
    /** Days from the anchor; every day gets every start time. */
    dayOffsets: number[];
    startTimes: string[];
    durationMinutes: number;
  };
};

export type EventTemplate = SignupTemplate | PollTemplate;

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;

/** The first `weekday` strictly after today. */
const nextWeekday = (weekday: number): Extract<RelativeAnchor, { kind: "weekday" }> => ({
  kind: "weekday",
  weekday,
  minOffsetDays: 1,
});

function task(title: string, capacity: number) {
  return { title, capacity };
}

export const TEMPLATES: EventTemplate[] = [
  // --- Sign-up sheets -------------------------------------------------------
  {
    slug: "staff-appreciation-week",
    type: "SIGNUP_SHEET",
    name: "Staff appreciation week",
    tagline: "A different treat each day, Monday to Friday",
    category: "school",
    icon: "heart",
    seo: {
      title: "Staff Appreciation Week Sign-Up Sheet — Free Template",
      description:
        "Plan a Monday–Friday staff appreciation week: breakfast, coffee bar, lunch, snacks and desserts, each on its own day. Free, no accounts.",
      h1: "Staff appreciation week sign-up sheet",
      intro: [
        "A staff appreciation week works best when every day has a clear theme and families can see exactly what's still needed. This template sets up five days, Monday through Friday, with one theme per day — breakfast, a coffee bar, lunch, snacks and desserts.",
        "Each shift only runs on its own day, so the Monday breakfast list never shows up on Wednesday. Rename the themes, change the number of spots, or add a day before you share the link.",
      ],
      tips: [
        "Put allergy notes and drop-off instructions in the description so every volunteer sees them.",
        "Keep one or two spots per item smaller than you think — it's easier to add spots than to deal with ten trays of muffins.",
        "Share the link at least a week ahead, then again the Friday before, so families can plan their shopping.",
      ],
      faqs: [
        {
          question: "Can I use different dates than Monday to Friday?",
          answer:
            "Yes. The template starts on the next Monday, but you can pick any first day and any number of days before creating the sheet. Each shift keeps its own day.",
        },
        {
          question: "Do families need an account to sign up?",
          answer: "No. They open the link, pick an item, and enter their name. An email is optional and gets them a reminder.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Staff Appreciation Week",
        description:
          "Thank you for helping us celebrate our staff! Please drop items off at the front office by 7:30 AM on your day and label anything containing common allergens.",
        location: "[Your school] front office",
        timezone: null,
      },
      anchor: nextWeekday(MON),
      dates: { mode: "range", spanDays: 5 },
      shifts: [
        { name: "Monday breakfast", startTime: "07:00", endTime: "08:00", days: { kind: "dateOffsets", values: [0] }, tasks: [task("Breakfast casserole or quiche", 3), task("Fruit tray", 2), task("Juice", 2)] },
        { name: "Tuesday coffee bar", startTime: "07:00", endTime: "08:00", days: { kind: "dateOffsets", values: [1] }, tasks: [task("Coffee (box or carafe)", 3), task("Creamers and sweeteners", 2), task("Pastries", 3)] },
        { name: "Wednesday lunch", startTime: "11:00", endTime: "12:30", days: { kind: "dateOffsets", values: [2] }, tasks: [task("Main dish", 4), task("Salad", 3), task("Plates, cups and napkins", 1)] },
        { name: "Thursday snacks", startTime: "13:00", endTime: "14:00", days: { kind: "dateOffsets", values: [3] }, tasks: [task("Salty snacks", 3), task("Sweet snacks", 3), task("Sparkling water", 2)] },
        { name: "Friday desserts", startTime: "12:00", endTime: "13:00", days: { kind: "dateOffsets", values: [4] }, tasks: [task("Cookies or brownies", 4), task("Cake or pie", 2), task("Thank-you card for the lounge", 1)] },
      ],
    },
  },
  {
    slug: "book-fair",
    type: "SIGNUP_SHEET",
    name: "Book fair",
    tagline: "Setup, daily sales shifts and teardown",
    category: "school",
    icon: "book",
    seo: {
      title: "Book Fair Volunteer Sign-Up Sheet — Free Template",
      description:
        "Staff a week-long book fair: setup on day one, cashier and helper shifts every day, and teardown on the last day. Free, no accounts.",
      h1: "Book fair volunteer sign-up sheet",
      intro: [
        "A book fair needs a burst of help at the start and end, and a steady crew in between. This template covers a five-day fair: setup before the doors open on the first day, cashier and floor-helper shifts every day, and teardown after the last sale.",
        "Setup and teardown only appear on their own days, so volunteers see a clean list for each day of the fair.",
      ],
      tips: [
        "Ask cashiers to arrive ten minutes early for a quick walkthrough of the register.",
        "Two floor helpers per shift is usually enough for browsing classes; add more for family night.",
        "Mention in the description whether younger siblings can come along to shifts.",
      ],
      faqs: [
        {
          question: "Our fair runs three days, not five. Can I change it?",
          answer:
            "Yes. Change the last day before creating the sheet. If teardown should move to the new last day, adjust which days that shift runs on.",
        },
        {
          question: "Can volunteers cancel their own shift?",
          answer: "Yes. Volunteers who leave an email get a link to cancel, and the organizer can remove sign-ups from the admin view.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Book Fair Volunteers",
        description:
          "Help our readers find their next favorite book! Please check in at the library desk when you arrive. Cashiers, come 10 minutes early for a quick register walkthrough.",
        location: "[Your school] library",
        timezone: null,
      },
      anchor: nextWeekday(MON),
      dates: { mode: "range", spanDays: 5 },
      shifts: [
        { name: "Setup", startTime: "07:00", endTime: "08:00", days: { kind: "dateOffsets", values: [0] }, tasks: [task("Unpack cases and set up tables", 4), task("Signs and price labels", 2)] },
        { name: "Morning sales", startTime: "08:00", endTime: "11:30", days: { kind: "all" }, tasks: [task("Cashier", 2), task("Floor helper", 2)] },
        { name: "Afternoon sales", startTime: "11:30", endTime: "15:00", days: { kind: "all" }, tasks: [task("Cashier", 2), task("Floor helper", 2)] },
        { name: "Teardown", startTime: "15:00", endTime: "16:30", days: { kind: "dateOffsets", values: [4] }, tasks: [task("Pack cases and fold tables", 4)] },
      ],
    },
  },
  {
    slug: "parent-teacher-conferences",
    type: "SIGNUP_SHEET",
    name: "Parent–teacher conferences",
    tagline: "15-minute slots, one family each",
    category: "school",
    icon: "school",
    seo: {
      title: "Parent Teacher Conference Sign-Up Sheet — Free Template",
      description:
        "Let families book a 15-minute parent–teacher conference slot from 3:00 to 6:00 PM. One family per slot, no accounts, free.",
      h1: "Parent–teacher conference sign-up sheet",
      intro: [
        "Conference scheduling is easiest when families pick their own time. This template creates twelve 15-minute slots from 3:00 to 6:00 PM, each with room for exactly one family, so nobody gets double-booked.",
        "Families see which slots are still open and claim one with just their name. Add a second afternoon, or shorten the window, before you share the link.",
      ],
      tips: [
        "Leave one slot empty in the middle of the afternoon as a buffer for conferences that run long.",
        "Ask families to add their student's name in the sign-up note so you can pull work samples ahead of time.",
        "Put the room number and any sign-in steps in the location and description.",
      ],
      faqs: [
        {
          question: "Can I make the slots 20 minutes instead of 15?",
          answer: "Yes. Edit the start and end time of each slot before creating the sheet, or remove slots you don't need.",
        },
        {
          question: "Will families get a reminder?",
          answer: "Families who leave an email get a reminder before their slot and can add it to their calendar.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Parent–Teacher Conferences",
        description:
          "Please pick one 15-minute slot for your family. Add your student's name in the note. If none of these times work, contact me and we'll find another time.",
        location: "Room [number]",
        timezone: null,
      },
      anchor: nextWeekday(THU),
      dates: { mode: "single" },
      shifts: Array.from({ length: 12 }, (_, i) => {
        const at = (m: number) => `${String(15 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return { name: "", startTime: at(i * 15), endTime: at(i * 15 + 15), days: { kind: "all" as const }, tasks: [task("Family conference", 1)] };
      }),
    },
  },
  {
    slug: "potluck",
    type: "SIGNUP_SHEET",
    name: "Potluck",
    tagline: "Mains, sides, desserts and drinks",
    category: "social",
    icon: "utensils",
    seo: {
      title: "Potluck Sign-Up Sheet — Free Template, No Account",
      description:
        "Organize a potluck without five bowls of pasta salad: guests claim a main, side, dessert, drinks or supplies. Free and ad-free.",
      h1: "Potluck sign-up sheet",
      intro: [
        "The hardest part of a potluck is the balance. This template splits the meal into mains, sides, desserts, drinks and supplies, with a set number of spots for each, so you end up with a full table instead of six desserts.",
        "Guests see what's already covered and what's still missing, then claim a dish with their name. There are no times to manage — just what to bring.",
      ],
      tips: [
        "Ask guests to note their dish in the sign-up note so others can avoid duplicates.",
        "Include serving utensils in the supplies list; they're the thing everyone forgets.",
        "Mention dietary needs (vegetarian, nut-free) in the description so cooks can plan.",
      ],
      faqs: [
        {
          question: "Can guests see who is bringing what?",
          answer: "Yes. Anyone with the link can see names and notes, which helps avoid duplicate dishes.",
        },
        {
          question: "How many spots should each category have?",
          answer:
            "A good starting point is one main for every six guests, one side for every five, and a few desserts. The template's numbers suit about 25 people.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Potluck Dinner",
        description:
          "Bring a dish to share! Please add what you're bringing in the note so we get a good mix. Label anything with nuts, dairy or gluten.",
        location: "[Venue or address]",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "single" },
      shifts: [
        { name: "Main dishes", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Main dish", 4), task("Vegetarian main", 2)] },
        { name: "Sides and salads", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Side dish", 4), task("Salad", 2), task("Bread or rolls", 1)] },
        { name: "Desserts", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Dessert", 3)] },
        { name: "Drinks and supplies", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Drinks", 3), task("Plates, cups and napkins", 1), task("Serving utensils", 1), task("Ice", 1)] },
      ],
    },
  },
  {
    slug: "classroom-party",
    type: "SIGNUP_SHEET",
    name: "Classroom party",
    tagline: "Party helpers plus snacks and supplies",
    category: "school",
    icon: "party",
    seo: {
      title: "Classroom Party Sign-Up Sheet — Free Template",
      description:
        "Organize a classroom party: setup, game and craft helpers during the party, plus snacks, drinks and supplies to bring. Free, no accounts.",
      h1: "Classroom party sign-up sheet",
      intro: [
        "Classroom parties go smoothly with a few helpers in the room and the right supplies on the table. This template has a short setup shift, helper roles during the party, and a list of things to bring.",
        "Room parents can share one link with the whole class and see at a glance what's covered.",
      ],
      tips: [
        "Check the school's food policy and put it in the description — many classrooms need store-bought, labeled snacks.",
        "Limit in-room helpers to what the classroom can hold comfortably; three or four is usually plenty.",
        "Ask the teacher which activity they'd like before choosing the craft.",
      ],
      faqs: [
        {
          question: "Can I use this for any holiday or end-of-year party?",
          answer: "Yes. Rename the title and change the craft or game roles to match the occasion.",
        },
        {
          question: "Do parents who only bring supplies need to come to the party?",
          answer: "No. The supplies list has no time, so parents can drop items off in the morning.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Classroom Party",
        description:
          "Thanks for helping make our class party fun! Please send store-bought, labeled snacks per school policy. Party helpers, check in at the office first.",
        location: "Room [number]",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "13:30", endTime: "14:00", days: { kind: "all" }, tasks: [task("Set up tables and decorations", 2)] },
        { name: "Party", startTime: "14:00", endTime: "15:00", days: { kind: "all" }, tasks: [task("Game leader", 1), task("Craft helper", 2), task("Cleanup helper", 1)] },
        { name: "Things to bring", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Snack", 4), task("Drinks", 2), task("Plates and napkins", 1), task("Craft supplies", 1)] },
      ],
    },
  },
  {
    slug: "bake-sale",
    type: "SIGNUP_SHEET",
    name: "Bake sale",
    tagline: "Bakers, sellers, setup and cleanup",
    category: "fundraising",
    icon: "cake",
    seo: {
      title: "Bake Sale Sign-Up Sheet — Free Fundraiser Template",
      description:
        "Run a bake sale fundraiser: bakers sign up for what they'll bring, and volunteers take setup, selling and cleanup shifts. Free, no accounts.",
      h1: "Bake sale sign-up sheet",
      intro: [
        "A bake sale needs two kinds of help: people to bake and people to sell. This template handles both — a list of baked goods with a set number of each, and two-hour selling shifts with setup and cleanup on either side.",
        "Bakers can drop off without staying, and sellers know exactly when they're on.",
      ],
      tips: [
        "Ask bakers to package items individually and list ingredients on a card.",
        "Keep a small cash box with change and a sign for mobile payments; note who brings it.",
        "Two sellers per shift keeps the table staffed through breaks.",
      ],
      faqs: [
        {
          question: "How many baked goods do we need?",
          answer:
            "For a morning sale, 10–12 batches is a good start. The template asks for twelve batches plus a few gluten-free items.",
        },
        {
          question: "Can I add a second day?",
          answer: "Yes. Switch the event to multiple days before creating it, and every shift repeats on each day.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Bake Sale",
        description:
          "All proceeds support [cause]. Bakers: please package items individually and include an ingredient card. Drop off at the table by 8:30 AM.",
        location: "[Location]",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "single" },
      shifts: [
        { name: "Baked goods", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Batch of cookies or brownies", 8), task("Cake, pie or loaf", 4), task("Gluten-free treats", 2)] },
        { name: "Setup", startTime: "08:00", endTime: "09:00", days: { kind: "all" }, tasks: [task("Set up table and signs", 2)] },
        { name: "Selling", startTime: "09:00", endTime: "11:00", days: { kind: "all" }, tasks: [task("Seller", 2)] },
        { name: "Selling", startTime: "11:00", endTime: "13:00", days: { kind: "all" }, tasks: [task("Seller", 2)] },
        { name: "Cleanup", startTime: "13:00", endTime: "14:00", days: { kind: "all" }, tasks: [task("Pack up and count money", 2)] },
      ],
    },
  },
  {
    slug: "concession-stand",
    type: "SIGNUP_SHEET",
    name: "Concession stand",
    tagline: "Every home game, first and second half",
    category: "sports",
    icon: "popcorn",
    seo: {
      title: "Concession Stand Volunteer Sign-Up — Free Template",
      description:
        "Staff the concession stand for every home game of the season with first- and second-half shifts. Repeats weekly. Free, no accounts.",
      h1: "Concession stand volunteer sign-up sheet",
      intro: [
        "Concession stands run on a steady rotation of families. This template repeats every Friday for eight weeks, with a first-half and second-half shift at each game and a grill, cashier and runner in each.",
        "Families can scan the whole season in one place and pick the games that work for them.",
      ],
      tips: [
        "Ask the first shift to arrive 30 minutes before kickoff to get the grill going.",
        "Post food-handling basics in the description, like gloves and hand washing.",
        "Change the repeat to match your real schedule if home games aren't every week.",
      ],
      faqs: [
        {
          question: "Our home games are on different days. What then?",
          answer:
            "Change the first date and the repeat before creating the sheet — for example every other Saturday, or a custom set of weekdays.",
        },
        {
          question: "Can a family sign up for more than one game?",
          answer: "Yes. Each game day is listed separately, and a family can claim a spot on as many as they like.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Concession Stand Volunteers",
        description:
          "Thanks for supporting the team! First-half volunteers, please arrive 30 minutes before kickoff. Gloves and aprons are in the stand.",
        location: "[Field] concession stand",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [FRI] }, ends: { after: 8 } },
      shifts: [
        { name: "First half", startTime: "18:00", endTime: "19:30", days: { kind: "all" }, tasks: [task("Grill", 1), task("Cashier", 1), task("Runner", 1)] },
        { name: "Second half", startTime: "19:30", endTime: "21:00", days: { kind: "all" }, tasks: [task("Grill", 1), task("Cashier", 1), task("Cleanup", 1)] },
      ],
    },
  },
  {
    slug: "car-wash-fundraiser",
    type: "SIGNUP_SHEET",
    name: "Car wash fundraiser",
    tagline: "Washers, sign holders and a cashier",
    category: "fundraising",
    icon: "droplets",
    seo: {
      title: "Car Wash Fundraiser Sign-Up Sheet — Free Template",
      description:
        "Plan a car wash fundraiser with two-hour shifts of washers, sign holders and a cashier, plus a supplies list. Free, no accounts.",
      h1: "Car wash fundraiser sign-up sheet",
      intro: [
        "A car wash raises the most when the line keeps moving. This template sets up three two-hour shifts, each with washers, sign holders to wave cars in, and a cashier, plus a list of supplies to bring.",
        "Volunteers pick a shift that fits their day, and you can see right away if the afternoon needs more hands.",
      ],
      tips: [
        "Put the rain date in the description so volunteers know the plan if the weather turns.",
        "Sign holders at the nearest intersection bring in more cars than anything else.",
        "Ask everyone to wear clothes and shoes that can get wet.",
      ],
      faqs: [
        {
          question: "How many washers per shift?",
          answer: "Four washers can handle a steady line of cars; add more if you're expecting a busy location.",
        },
        {
          question: "Can volunteers bring supplies without working a shift?",
          answer: "Yes. The supplies list has no time attached, so anyone can sign up to bring buckets or towels.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Car Wash Fundraiser",
        description:
          "Help us raise money for [cause]! Wear clothes and shoes that can get wet. Rain date: [date].",
        location: "[Location]",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "single" },
      shifts: [
        { name: "Morning", startTime: "09:00", endTime: "11:00", days: { kind: "all" }, tasks: [task("Washer", 4), task("Sign holder", 2), task("Cashier", 1)] },
        { name: "Midday", startTime: "11:00", endTime: "13:00", days: { kind: "all" }, tasks: [task("Washer", 4), task("Sign holder", 2), task("Cashier", 1)] },
        { name: "Afternoon", startTime: "13:00", endTime: "15:00", days: { kind: "all" }, tasks: [task("Washer", 4), task("Sign holder", 2), task("Cashier", 1)] },
        { name: "Supplies", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Buckets and sponges", 2), task("Towels", 2), task("Car wash soap", 1)] },
      ],
    },
  },
  {
    slug: "thursday-folders",
    type: "SIGNUP_SHEET",
    name: "Thursday folders helper",
    tagline: "Stuff weekly take-home folders, September to June",
    category: "school",
    icon: "folder",
    seo: {
      title: "Thursday Folders Volunteer Sign-Up — Weekly Room Parent",
      description:
        "Room parents sign up to stuff Thursday folders (Thursday recorders) with flyers and school updates: 30 minutes every Thursday, September to June.",
      h1: "Thursday folders helper sign-up sheet",
      intro: [
        "Many schools send a weekly take-home folder — Thursday folders, Thursday recorders or Friday folders — with flyers, graded work and school news. Someone has to sort all that paper into every student's folder, and it goes quickly with a rotating room-parent helper.",
        "This sheet repeats every Thursday at 2:00 PM for 30 minutes through the school year, September to June. Parents claim the weeks that fit their schedule, and the teacher can see who's coming each week.",
      ],
      tips: [
        "There are no folders during winter and spring break — say so in the description so nobody signs up for those weeks.",
        "Leave the flyers and class list in the same spot each week so helpers can start right away.",
        "Add the workroom and sign-in steps to the location, since helpers come during the school day.",
      ],
      faqs: [
        {
          question: "Can I skip holiday and break weeks?",
          answer:
            "The sheet repeats every Thursday until mid-June. Put your school's break dates in the description so parents don't sign up for those weeks.",
        },
        {
          question: "Our folders go home on Fridays. Can I change the day?",
          answer: "Yes. Pick a different first date and weekday before creating the sheet — the shift follows the new day.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Thursday Folders Helper",
        description:
          "Help stuff our class's Thursday folders with flyers and school updates. Please sign in at the front office. No folders during winter break ([dates]) or spring break ([dates]) — please don't sign up for those weeks.",
        location: "[Your school] workroom",
        timezone: null,
      },
      // From the next Thursday until the next June 15 — or from the first
      // Thursday of September when opened in June or over the summer, so a
      // sheet made in early June isn't just the year's last week or two.
      anchor: { kind: "weekday", weekday: THU, minOffsetDays: 1, outside: { from: "06-01", to: "08-31" } },
      dates: { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [THU] }, ends: { untilMonthDay: "06-15" } },
      shifts: [{ name: "Thursday folders", startTime: "14:00", endTime: "14:30", days: { kind: "all" }, tasks: [task("Folder helper", 1)] }],
    },
  },
  {
    slug: "meal-train",
    type: "SIGNUP_SHEET",
    name: "Meal train",
    tagline: "One dinner a day for two weeks",
    category: "community",
    icon: "soup",
    seo: {
      title: "Meal Train Sign-Up Sheet — Free Template, No Account",
      description:
        "Organize meals for a family with a new baby, an illness or a loss: one dinner drop-off per day for two weeks. Free and ad-free.",
      h1: "Meal train sign-up sheet",
      intro: [
        "When a friend has a new baby, surgery or a loss, a meal train turns a lot of kind offers into an actual plan. This template creates one dinner drop-off per day for fourteen days, starting tomorrow, with one spot each so no family gets two lasagnas on the same night.",
        "Helpers see which nights are open and claim one with their name — no app to download and no account.",
      ],
      tips: [
        "Put dietary restrictions, favorite foods and how many people to feed in the description.",
        "Suggest disposable containers so the family doesn't have dishes to return.",
        "Say whether helpers should knock or leave meals in a cooler by the door.",
      ],
      faqs: [
        {
          question: "Can I skip some days?",
          answer:
            "Yes. Before creating the sheet, change the dates or limit the dinner shift to the days you need.",
        },
        {
          question: "Will the family's address be public?",
          answer:
            "Anyone with the link can see the event page, so share drop-off details privately or keep them general in the description.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Meal Train for [Family name]",
        description:
          "Let's help the [Family name] family with dinners. They're feeding [number] people and avoid [allergies]. Please use disposable containers and leave meals in the cooler by the door.",
        location: "",
        timezone: null,
      },
      anchor: { kind: "offset", offsetDays: 1 },
      dates: { mode: "range", spanDays: 14 },
      shifts: [{ name: "Dinner drop-off", startTime: "17:00", endTime: "18:00", days: { kind: "all" }, tasks: [task("Dinner", 1)] }],
    },
  },

  {
    slug: "staff-welcome-back-lunch",
    type: "SIGNUP_SHEET",
    name: "Staff welcome back lunch",
    tagline: "Kick off the year with a staff lunch",
    category: "school",
    icon: "sandwich",
    seo: {
      title: "Staff Welcome Back Lunch Sign-Up Sheet — Free Template",
      description:
        "Welcome teachers and staff back with a PTA-hosted lunch: setup, serving and cleanup shifts plus a list of dishes to bring. Free, no accounts.",
      h1: "Staff welcome back lunch sign-up sheet",
      intro: [
        "The first week back is hectic for teachers, and a lunch they don't have to think about sets the tone for the year. This template covers the whole thing: a short setup shift, a serving crew during lunch, cleanup afterwards, and a list of mains, salads, desserts and drinks for families to bring.",
        "Families who can't be there at lunchtime can still help by dropping off a dish in the morning.",
      ],
      tips: [
        "Ask the office how many staff to expect, then set the number of dishes to match.",
        "Label dishes with common allergens and keep a vegetarian main on the list.",
        "Leave a thank-you card by the sign-in sheet so families can add a note.",
      ],
      faqs: [
        {
          question: "Can families help without coming at lunchtime?",
          answer: "Yes. The food list has no time attached, so families can sign up to drop off a dish in the morning.",
        },
        {
          question: "Do volunteers need an account?",
          answer: "No. They open the link, pick a spot, and enter their name.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Staff Welcome Back Lunch",
        description:
          "Let's welcome our teachers and staff back! Please drop food off in the staff lounge by 10:30 AM and label anything containing common allergens.",
        location: "[Your school] staff lounge",
        timezone: null,
      },
      anchor: nextWeekday(THU),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "10:30", endTime: "11:00", days: { kind: "all" }, tasks: [task("Set up tables and decorations", 3)] },
        { name: "Lunch", startTime: "11:00", endTime: "13:00", days: { kind: "all" }, tasks: [task("Server", 3), task("Drinks station", 1)] },
        { name: "Cleanup", startTime: "13:00", endTime: "13:30", days: { kind: "all" }, tasks: [task("Clean up and pack leftovers", 2)] },
        { name: "Food to bring", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Main dish", 4), task("Vegetarian main", 1), task("Salad", 3), task("Dessert", 4), task("Drinks", 2), task("Plates, cups and cutlery", 1)] },
      ],
    },
  },
  {
    slug: "back-to-school-night",
    type: "SIGNUP_SHEET",
    name: "Back to school night",
    tagline: "Greeters, guides and the PTA table",
    category: "school",
    icon: "backpack",
    seo: {
      title: "Back to School Night Volunteer Sign-Up — Free Template",
      description:
        "Staff back to school night: welcome table, hallway guides, PTA membership table and cleanup. Parents claim a spot with just a name. Free.",
      h1: "Back to school night volunteer sign-up sheet",
      intro: [
        "Back to school night is many families' first visit to the building, and a few friendly volunteers make it feel welcoming. This template sets up a welcome table, hallway guides to point families to classrooms, a PTA membership table, and a short cleanup shift.",
        "Volunteers can pick a shift before or after their own classroom visits, so nobody misses time with their child's teacher.",
      ],
      tips: [
        "Print campus maps and room lists for the welcome table ahead of time.",
        "Have a QR code for the PTA's membership or volunteer page at the PTA table.",
        "Schedule guides for the first hour — that's when the hallways are busiest.",
      ],
      faqs: [
        {
          question: "Can parents volunteer and still visit their child's classroom?",
          answer:
            "Yes. Shifts are short and staggered, so parents can take a spot before or after their classroom sessions.",
        },
        {
          question: "Can I print a QR code for the sign-up sheet?",
          answer: "Yes. Every event has a QR code you can print for newsletters or flyers.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Back to School Night Volunteers",
        description:
          "Help welcome families to a new school year! Please check in at the front office 10 minutes before your shift.",
        location: "[Your school]",
        timezone: null,
      },
      anchor: nextWeekday(WED),
      dates: { mode: "single" },
      shifts: [
        { name: "Welcome table", startTime: "17:30", endTime: "18:30", days: { kind: "all" }, tasks: [task("Greeter", 2), task("Maps and name tags", 1)] },
        { name: "Hallway guides", startTime: "18:00", endTime: "19:00", days: { kind: "all" }, tasks: [task("Hallway guide", 3)] },
        { name: "PTA table", startTime: "17:30", endTime: "19:30", days: { kind: "all" }, tasks: [task("Membership and volunteer sign-ups", 2)] },
        { name: "Cleanup", startTime: "19:30", endTime: "20:00", days: { kind: "all" }, tasks: [task("Pack up tables and signs", 2)] },
      ],
    },
  },
  {
    slug: "movie-night",
    type: "SIGNUP_SHEET",
    name: "Movie night",
    tagline: "Setup, concessions and floor helpers",
    category: "school",
    icon: "film",
    seo: {
      title: "School Movie Night Volunteer Sign-Up — Free Template",
      description:
        "Run a family movie night: setup, popcorn and concessions, floor helpers during the film, cleanup, and snacks to donate. Free, no accounts.",
      h1: "Movie night volunteer sign-up sheet",
      intro: [
        "A family movie night is one of the easiest events to love and one of the easiest to under-staff. This template covers setup of the screen and seating, a concessions crew for popcorn and drinks, floor helpers while the film runs, and cleanup at the end.",
        "There's also a list of snacks and water to donate, so families who can't stay can still pitch in.",
      ],
      tips: [
        "Test the projector and sound during setup, not five minutes before showtime.",
        "Ask families to bring blankets and pillows, and say so in the description.",
        "Check the film's public performance license with your school or district.",
      ],
      faqs: [
        {
          question: "Can families donate snacks without volunteering?",
          answer: "Yes. The donation list has no time, so anyone can sign up to drop off water or snacks.",
        },
        {
          question: "Can I run concessions as a fundraiser?",
          answer: "Yes. Rename the concessions tasks or add a cashier — every task and spot is editable.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Family Movie Night",
        description:
          "Bring a blanket and join us for a movie under the stars (or the gym lights)! Volunteers, please check in at the concessions table.",
        location: "[Your school] field or gym",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "17:30", endTime: "18:30", days: { kind: "all" }, tasks: [task("Screen and sound", 2), task("Seating area", 2)] },
        { name: "Concessions", startTime: "18:00", endTime: "20:30", days: { kind: "all" }, tasks: [task("Popcorn", 2), task("Snacks and drinks cashier", 2)] },
        { name: "During the movie", startTime: "18:30", endTime: "20:30", days: { kind: "all" }, tasks: [task("Floor helper", 2)] },
        { name: "Cleanup", startTime: "20:30", endTime: "21:00", days: { kind: "all" }, tasks: [task("Cleanup crew", 3)] },
        { name: "Donations", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Case of bottled water", 2), task("Candy or snacks", 2)] },
      ],
    },
  },
  {
    slug: "bike-to-school-day",
    type: "SIGNUP_SHEET",
    name: "Bike to school day",
    tagline: "Route marshals and a welcome station",
    category: "school",
    icon: "bike",
    seo: {
      title: "Bike to School Day Volunteer Sign-Up — Free Template",
      description:
        "Organize a fall or spring bike and walk to school day: route marshals, bike train leaders, a welcome station and snacks to bring. Free.",
      h1: "Bike to school day volunteer sign-up sheet",
      intro: [
        "Bike and walk to school days work because enough adults are out along the route. This template sets up route marshals and bike train leaders for the ride in, a welcome station with snacks and stickers at school, and a bike parking helper.",
        "Use it for the fall event, then make a copy of the finished sheet for spring — same shifts, new date.",
      ],
      tips: [
        "Share the meeting points and departure times for each bike train in the description.",
        "Ask marshals to wear a bright vest and stand at the busiest crossings.",
        "Plan extra bike parking — racks fill up fast on the day.",
      ],
      faqs: [
        {
          question: "We hold one in fall and one in spring. Do I need two templates?",
          answer:
            "No. Create the fall sheet from this template, then use Make a copy on the event page in spring to get the same shifts on a new date.",
        },
        {
          question: "What time should marshals arrive?",
          answer: "The template starts marshals at 7:15 AM; change the times to match your school's start time.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Bike to School Day",
        description:
          "Ride or walk to school with us! Bike trains leave from [meeting points] at [time]. Helmets required.",
        location: "[Your school]",
        timezone: null,
      },
      anchor: nextWeekday(WED),
      dates: { mode: "single" },
      shifts: [
        { name: "On the route", startTime: "07:15", endTime: "08:00", days: { kind: "all" }, tasks: [task("Crossing marshal", 4), task("Bike train leader", 2)] },
        { name: "Welcome station", startTime: "07:30", endTime: "08:15", days: { kind: "all" }, tasks: [task("Snacks and stickers", 2), task("Bike parking helper", 2)] },
        { name: "Things to bring", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Fruit or granola bars", 3), task("Water", 1)] },
      ],
    },
  },
  {
    slug: "culture-and-heritage-night",
    type: "SIGNUP_SHEET",
    name: "Culture and heritage night",
    tagline: "Family tables, performances and food to share",
    category: "school",
    icon: "globe",
    seo: {
      title: "Culture and Heritage Night Sign-Up Sheet — Free Template",
      description:
        "Plan a multicultural night: families host a table about their culture, share a dish, or help with setup, performances and cleanup. Free.",
      h1: "Culture and heritage night sign-up sheet",
      intro: [
        "A culture and heritage night lets families share where they come from — food, music, games and traditions. This template gives families a spot to host a table, bring a dish to share, or help with setup, the performance stage and cleanup.",
        "Table hosts can note their country or tradition in the sign-up, so you can plan the room and avoid gaps.",
      ],
      tips: [
        "Ask table hosts to add their country or tradition in the sign-up note.",
        "Label dishes with their name and main ingredients for guests with allergies.",
        "Give performers a running order and a time in the description.",
      ],
      faqs: [
        {
          question: "How do I know which cultures will be represented?",
          answer:
            "Table hosts can add a note when they sign up, and everyone with the link can see names and notes.",
        },
        {
          question: "Can families bring food without hosting a table?",
          answer: "Yes. The food list is separate from the tables and has no time attached.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Culture and Heritage Night",
        description:
          "Celebrate the cultures in our community! Host a table, share a dish, or help out. Table hosts: please add your country or tradition in the note.",
        location: "[Your school] cafeteria",
        timezone: null,
      },
      anchor: nextWeekday(THU),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "16:30", endTime: "17:30", days: { kind: "all" }, tasks: [task("Tables and decorations", 3)] },
        { name: "Culture tables", startTime: "17:30", endTime: "19:30", days: { kind: "all" }, tasks: [task("Table host (share a culture or tradition)", 8)] },
        { name: "Performances", startTime: "18:00", endTime: "19:00", days: { kind: "all" }, tasks: [task("Stage helper", 2)] },
        { name: "Cleanup", startTime: "19:30", endTime: "20:15", days: { kind: "all" }, tasks: [task("Cleanup crew", 3)] },
        { name: "Food to share", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Dish from your culture", 8)] },
      ],
    },
  },
  {
    slug: "thanksgiving-lunch",
    type: "SIGNUP_SHEET",
    name: "Thanksgiving lunch",
    tagline: "Servers, setup and pies for a school feast",
    category: "school",
    icon: "drumstick",
    seo: {
      title: "Thanksgiving Lunch Volunteer Sign-Up — Free Template",
      description:
        "Staff a school Thanksgiving lunch or family feast: setup, servers, line helpers and cleanup, plus pies and rolls to bring. Free, no accounts.",
      h1: "Thanksgiving lunch volunteer sign-up sheet",
      intro: [
        "A school Thanksgiving lunch means a lot of families in the cafeteria at once. This template sets up table setup before lunch, servers and line helpers during the lunch periods, a cleanup crew, and a list of pies, rolls and supplies to bring.",
        "It works for a class feast or a whole-school family lunch — change the times to match your lunch schedule.",
      ],
      tips: [
        "Match serving shifts to your lunch periods so each grade has helpers.",
        "Ask for store-bought desserts if your school requires them.",
        "Share where families should park and sign in, since many will visit at once.",
      ],
      faqs: [
        {
          question: "Can I use this for a different holiday lunch?",
          answer: "Yes. Rename the title and change the food list for any holiday or end-of-year lunch.",
        },
        {
          question: "Can volunteers see which pies are already coming?",
          answer: "Yes. Everyone with the link can see who signed up for what, including their notes.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Thanksgiving Lunch",
        description:
          "Help us serve our school Thanksgiving lunch! Volunteers, please sign in at the office. Desserts should be store-bought and labeled.",
        location: "[Your school] cafeteria",
        timezone: null,
      },
      anchor: nextWeekday(THU),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "10:00", endTime: "10:45", days: { kind: "all" }, tasks: [task("Set tables", 3)] },
        { name: "Serving", startTime: "10:45", endTime: "12:45", days: { kind: "all" }, tasks: [task("Server", 4), task("Line helper", 2)] },
        { name: "Cleanup", startTime: "12:45", endTime: "13:30", days: { kind: "all" }, tasks: [task("Cleanup crew", 3)] },
        { name: "Things to bring", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Pie or dessert", 6), task("Dinner rolls", 2), task("Plates and napkins", 1)] },
      ],
    },
  },
  {
    slug: "skate-night",
    type: "SIGNUP_SHEET",
    name: "Skate night",
    tagline: "Check-in, raffle table and rink-side helpers",
    category: "fundraising",
    icon: "star",
    seo: {
      title: "School Skate Night Volunteer Sign-Up — Free Template",
      description:
        "Staff a school skate night fundraiser at the rink: check-in and wristbands, raffle or bake table, rink-side helpers. Free, no accounts.",
      h1: "Skate night volunteer sign-up sheet",
      intro: [
        "Skate night is a favorite school fundraiser: the rink handles the skating, and a few volunteers handle everything that makes it your school's night. This template covers check-in and wristbands, a raffle or bake table, and rink-side helpers keeping an eye on younger skaters.",
        "Shifts split the evening in two, so volunteers still get time on the rink with their own kids.",
      ],
      tips: [
        "Confirm with the rink how check-in and the fundraiser share will work.",
        "Bring a cash box and a sign for mobile payments to the raffle table.",
        "Remind families that skate rental may cost extra.",
      ],
      faqs: [
        {
          question: "Can volunteers skate too?",
          answer: "Yes. Shifts are split into two halves, so every volunteer has time off to skate.",
        },
        {
          question: "Can I add a bake sale table?",
          answer: "Yes. Add a task for it, or rename the raffle table — everything is editable before you create the sheet.",
        },
      ],
    },
    prefill: {
      details: {
        title: "School Skate Night",
        description:
          "Roll with us to support [cause]! Volunteers, please check in at the front desk 10 minutes before your shift.",
        location: "[Rink name and address]",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "First half", startTime: "18:00", endTime: "19:00", days: { kind: "all" }, tasks: [task("Check-in and wristbands", 2), task("Raffle table", 1), task("Rink-side helper", 2)] },
        { name: "Second half", startTime: "19:00", endTime: "20:00", days: { kind: "all" }, tasks: [task("Check-in and wristbands", 1), task("Raffle table", 1), task("Rink-side helper", 2)] },
      ],
    },
  },
  {
    slug: "steam-night",
    type: "SIGNUP_SHEET",
    name: "STEAM night",
    tagline: "Science, engineering, art and math stations",
    category: "school",
    icon: "flask",
    seo: {
      title: "STEAM Night Volunteer Sign-Up Sheet — Free Template",
      description:
        "Run a family STEAM night: station leaders for science, engineering, art and math, plus setup, greeters and cleanup. Free, no accounts.",
      h1: "STEAM night volunteer sign-up sheet",
      intro: [
        "STEAM night turns the school into a hands-on lab for families. This template sets up station leaders for science, engineering, art and math activities, a greeter, and setup and cleanup crews.",
        "Station leaders don't need to be experts — clear instructions at each table and a friendly adult are what make it work.",
      ],
      tips: [
        "Send station leaders their activity and supply list a week ahead.",
        "Put a timer at each station so families rotate through the room.",
        "Ask local science or engineering professionals to lead a station.",
      ],
      faqs: [
        {
          question: "Do station leaders need a science background?",
          answer:
            "No. Most activities come with simple instructions; leaders guide families through them. Add details in the description.",
        },
        {
          question: "Can I add more stations?",
          answer: "Yes. Add tasks to the stations shift before creating the sheet.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Family STEAM Night",
        description:
          "Explore science, technology, engineering, art and math together! Station leaders will get their activity and supplies ahead of time.",
        location: "[Your school] gym",
        timezone: null,
      },
      anchor: nextWeekday(WED),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "16:45", endTime: "17:30", days: { kind: "all" }, tasks: [task("Set up stations", 4)] },
        { name: "Stations", startTime: "17:30", endTime: "19:00", days: { kind: "all" }, tasks: [task("Science station leader", 2), task("Engineering station leader", 2), task("Art station leader", 2), task("Math and coding station leader", 2)] },
        { name: "Welcome", startTime: "17:30", endTime: "18:30", days: { kind: "all" }, tasks: [task("Greeter", 1)] },
        { name: "Cleanup", startTime: "19:00", endTime: "19:45", days: { kind: "all" }, tasks: [task("Cleanup crew", 4)] },
      ],
    },
  },
  {
    slug: "cookie-bar",
    type: "SIGNUP_SHEET",
    name: "Cookie bar",
    tagline: "Cookies to bring, servers and a cashier",
    category: "school",
    icon: "cookie",
    seo: {
      title: "Cookie Bar Sign-Up Sheet — Free Template for PTAs",
      description:
        "Host a cookie bar after school or at an event: families bring cookies, volunteers set up, serve and run the cash table. Free, no accounts.",
      h1: "Cookie bar sign-up sheet",
      intro: [
        "A cookie bar is simple to run and always popular — as long as there are enough cookies and enough hands at the table. This template has a list of cookies for families to bring, plus setup, serving and cashier shifts and a short cleanup.",
        "Bakers can drop off in the morning without staying for the event.",
      ],
      tips: [
        "Ask for cookies by the dozen, individually wrapped if your school requires it.",
        "Put an allergen label on each tray, and keep nut-free cookies separate.",
        "Decide on prices ahead of time and post them on a sign at the table.",
      ],
      faqs: [
        {
          question: "Is this a fundraiser?",
          answer: "It can be. Keep the cashier task to sell cookies, or remove it to run the cookie bar as a free treat.",
        },
        {
          question: "Can bakers drop off without volunteering?",
          answer: "Yes. The cookie list has no time attached.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Cookie Bar",
        description:
          "Bring a dozen cookies to share! Please drop them off at the office by noon and label any common allergens.",
        location: "[Your school]",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Cookies to bring", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("A dozen cookies", 12), task("A dozen nut-free cookies", 3)] },
        { name: "Setup", startTime: "14:30", endTime: "15:00", days: { kind: "all" }, tasks: [task("Set up the table", 2)] },
        { name: "Cookie bar", startTime: "15:00", endTime: "16:00", days: { kind: "all" }, tasks: [task("Server", 3), task("Cashier", 1)] },
        { name: "Cleanup", startTime: "16:00", endTime: "16:30", days: { kind: "all" }, tasks: [task("Cleanup", 2)] },
      ],
    },
  },
  {
    slug: "bingo-night",
    type: "SIGNUP_SHEET",
    name: "Bingo night",
    tagline: "Caller, card sales, prizes and snacks",
    category: "fundraising",
    icon: "bingo",
    seo: {
      title: "Bingo Night Volunteer Sign-Up Sheet — Free Template",
      description:
        "Run a family bingo night fundraiser: caller, card sales, prize runners, snack table, setup and cleanup, plus prize donations. Free.",
      h1: "Bingo night volunteer sign-up sheet",
      intro: [
        "Family bingo night fills the cafeteria and needs a small, organized crew. This template covers setup, a caller, card sales, prize runners, a snack table, cleanup, and a list of prize donations families can contribute.",
        "Everyone can see which roles are filled, so you're not scrambling for a caller the night before.",
      ],
      tips: [
        "Pick a caller with a strong voice — or book a microphone.",
        "Ask families or local businesses to donate prize baskets and list them in notes.",
        "Pre-count bingo cards and daubers into bundles for faster sales.",
      ],
      faqs: [
        {
          question: "How many volunteers does bingo night need?",
          answer: "About 10–12 for a school cafeteria: the template's numbers are a good start, and you can change any of them.",
        },
        {
          question: "Can donors sign up without volunteering?",
          answer: "Yes. Prize donations are a separate list with no time attached.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Family Bingo Night",
        description:
          "B-I-N-G-O! Help us run a fun night for families. Prize donors: please add what you're donating in the note.",
        location: "[Your school] cafeteria",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "17:00", endTime: "18:00", days: { kind: "all" }, tasks: [task("Tables and chairs", 3), task("Prize table", 1)] },
        { name: "Bingo", startTime: "18:00", endTime: "20:00", days: { kind: "all" }, tasks: [task("Caller", 1), task("Card sales", 2), task("Prize runner", 2), task("Snack table", 2)] },
        { name: "Cleanup", startTime: "20:00", endTime: "20:30", days: { kind: "all" }, tasks: [task("Cleanup crew", 3)] },
        { name: "Prize donations", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Prize basket or gift card", 6)] },
      ],
    },
  },
  {
    slug: "school-basketball-game",
    type: "SIGNUP_SHEET",
    name: "School basketball game",
    tagline: "Admission, concessions and the scoreboard",
    category: "sports",
    icon: "medal",
    seo: {
      title: "School Basketball Game Volunteer Sign-Up — Free Template",
      description:
        "Staff a school basketball game: admission table, concessions, scoreboard and clock, and cleanup. Parents claim a spot with just a name. Free.",
      h1: "School basketball game volunteer sign-up sheet",
      intro: [
        "A home basketball game needs more than players: someone at the door, someone running the clock, and a concessions crew. This template covers admission, concessions, scoreboard and clock, and a quick cleanup after the final buzzer.",
        "Parents of players and fans alike can pick a job for the game and still catch most of it.",
      ],
      tips: [
        "Have a quick walkthrough of the scoreboard controls before tip-off.",
        "Bring change and a sign for mobile payments to the admission and concessions tables.",
        "Replace [Opponent] in the title so families know which game it is.",
      ],
      faqs: [
        {
          question: "We have a game every week. Can the sheet repeat?",
          answer:
            "Yes. Switch the event to repeat (for example every Friday) before creating it, and every game gets the same jobs.",
        },
        {
          question: "Can I use this for volleyball or other sports?",
          answer: "Yes. Change the title and tasks — the structure works for any home game.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Basketball Game vs. [Opponent]",
        description:
          "Help us host our home game! Scoreboard volunteers, please arrive 15 minutes early for a quick walkthrough.",
        location: "[Your school] gym",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Admission", startTime: "17:00", endTime: "18:00", days: { kind: "all" }, tasks: [task("Admission table", 2)] },
        { name: "Concessions", startTime: "17:30", endTime: "19:00", days: { kind: "all" }, tasks: [task("Cashier", 1), task("Snack table", 2)] },
        { name: "Scorer's table", startTime: "17:45", endTime: "19:00", days: { kind: "all" }, tasks: [task("Scoreboard", 1), task("Game clock", 1)] },
        { name: "Cleanup", startTime: "19:00", endTime: "19:30", days: { kind: "all" }, tasks: [task("Cleanup crew", 2)] },
      ],
    },
  },
  {
    slug: "spring-fundraiser",
    type: "SIGNUP_SHEET",
    name: "Spring fundraiser",
    tagline: "Order sorting and pickup day",
    category: "fundraising",
    icon: "piggy-bank",
    seo: {
      title: "School Fundraiser Volunteer Sign-Up — Free Template",
      description:
        "Staff a school fundraiser pickup day: count order forms, sort orders, run the pickup table and help carry to cars. Free, no accounts.",
      h1: "Spring fundraiser volunteer sign-up sheet",
      intro: [
        "Product fundraisers — flowers, cookie dough, wrapping paper — end with a big pickup day. This template covers counting order forms ahead of time, sorting orders, and a pickup table with car runners so families are in and out quickly.",
        "Use it for a spring fundraiser, then make a copy for the fall sale.",
      ],
      tips: [
        "Sort orders alphabetically by student or by class before pickup opens.",
        "Have a list of unclaimed orders and a plan for them at the end of the day.",
        "Share pickup times and location in the school newsletter too.",
      ],
      faqs: [
        {
          question: "Our fundraiser is a fun run, not a product sale. Does this work?",
          answer:
            "Change the shifts to match — for example course marshals, water table and check-in. Every task is editable before you create the sheet.",
        },
        {
          question: "Can I reuse this for the fall fundraiser?",
          answer: "Yes. Use Make a copy on the event page to get the same shifts with new dates.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Spring Fundraiser",
        description:
          "Thank you for supporting our fundraiser! Order pickup is [date] from 3:30 to 6:00 PM. Volunteers, please check in at the pickup table.",
        location: "[Your school] gym",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Before pickup day", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Count order forms", 2)] },
        { name: "Sorting", startTime: "14:00", endTime: "15:30", days: { kind: "all" }, tasks: [task("Sort orders", 4)] },
        { name: "Pickup", startTime: "15:30", endTime: "18:00", days: { kind: "all" }, tasks: [task("Pickup table", 3), task("Car runner", 2)] },
      ],
    },
  },
  {
    slug: "restaurant-spirit-night",
    type: "SIGNUP_SHEET",
    name: "Restaurant spirit night",
    tagline: "Dine-out fundraiser: greeters and promoters",
    category: "fundraising",
    icon: "restaurant",
    seo: {
      title: "Restaurant Spirit Night Sign-Up — Dining for Dollars",
      description:
        "Promote a restaurant spirit night (dining for dollars): greeters at the door, flyer and social media helpers. Free, no accounts.",
      h1: "Restaurant spirit night sign-up sheet",
      intro: [
        "Restaurant spirit nights — also called dining for dollars or dine-out nights — raise money when a local restaurant donates part of the evening's sales. The more families who come, the more you raise, so this template focuses on promotion and a friendly welcome.",
        "Volunteers can share the event online and hang flyers beforehand, and greeters welcome families at the door during the evening.",
      ],
      tips: [
        "Check whether the restaurant needs customers to mention the school or show a flyer.",
        "Post reminders the week before and the morning of.",
        "Ask greeters to wear school shirts so families can spot them.",
      ],
      faqs: [
        {
          question: "What does a greeter do?",
          answer:
            "Greeters welcome families at the door, remind them to mention the school at checkout, and answer questions.",
        },
        {
          question: "Can we hold spirit nights every month?",
          answer: "Yes. Make a copy of the event for each one, or switch it to repeat monthly before creating it.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Restaurant Spirit Night",
        description:
          "Eat out and support [cause]! [Restaurant] donates [percentage] of sales from 5 to 8 PM. Mention [your school] when you order.",
        location: "[Restaurant name and address]",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Spread the word", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Share on social media", 5), task("Hang flyers", 3)] },
        { name: "Early greeters", startTime: "17:00", endTime: "18:30", days: { kind: "all" }, tasks: [task("Greeter", 2)] },
        { name: "Late greeters", startTime: "18:30", endTime: "20:00", days: { kind: "all" }, tasks: [task("Greeter", 2)] },
      ],
    },
  },

  {
    slug: "snack-schedule",
    type: "SIGNUP_SHEET",
    name: "Team snack schedule",
    tagline: "One snack family per game for eight weeks",
    category: "sports",
    icon: "sandwich",
    seo: {
      title: "Team Snack Sign-Up Sheet — Free Weekly Schedule",
      description: "Plan eight weekly games with one snack family per game. Change the game day and season length before sharing. Free, no accounts or ads.",
      h1: "Team snack sign-up sheet",
      intro: [
        "To run a team snack schedule, give each game one snack slot with room for one family. This template repeats every Saturday for eight games, so parents can see which dates still need snacks.",
        "Change the first game date, repeat pattern and season length before sharing. The schedule follows the repeat pattern; individual games cannot be skipped or moved. Put the team size and food restrictions in the description.",
      ],
      tips: [
        "List the number of players so each family knows how many snacks to bring.",
        "Confirm food restrictions with the coach before suggesting snacks.",
        "Review all game dates against the team calendar before sharing the link.",
      ],
      faqs: [
        { question: "Can I change the game day or season length?", answer: "Yes. Edit the first date, repeat settings and end of the series before creating the sheet. The starter schedule has eight Saturday games." },
        { question: "Does each game have its own snack slot?", answer: "Yes. Each date has one slot for one family. Once claimed, that game's snack slot is full; other games remain available." },
      ],
    },
    prefill: {
      details: {
        title: "Team Snack Schedule",
        description: "Please choose a game to bring snacks for [number] players. Check with the coach about food restrictions and bring snacks to the team area after the game.",
        location: "[Your team's field]",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [SAT] }, ends: { after: 8 } },
      shifts: [{ name: "Game snacks", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Snack family", 1)] }],
    },
  },
  {
    slug: "trunk-or-treat",
    type: "SIGNUP_SHEET",
    name: "Trunk-or-treat",
    tagline: "Decorated cars, candy donations and event helpers",
    category: "community",
    icon: "party",
    seo: {
      title: "Trunk-or-Treat Sign-Up Sheet — Free Template",
      description: "Organize decorated cars, candy donations, setup and cleanup for a trunk-or-treat. Edit dates, times and spots. Free, no accounts or ads.",
      h1: "Trunk-or-treat sign-up sheet",
      intro: [
        "Organize a trunk-or-treat with separate sign-up spots for decorated cars, candy donations and volunteer shifts. This template starts with twelve car spaces, eight candy donations and timed setup, welcome and cleanup roles.",
        "Choose your October event date before sharing; the starter date is the next Saturday. Adjust the car capacity to match your venue and add arrival instructions for drivers.",
      ],
      tips: [
        "Ask drivers to arrive before visitors and keep cars parked until the event ends.",
        "Include venue-approved parking and pedestrian routes in the description.",
        "State candy requirements and offer a non-food treat option for visitors.",
      ],
      faqs: [
        { question: "Can people donate candy without decorating a car?", answer: "Yes. Candy donations and decorated cars have separate spots, so people can choose how to help." },
        { question: "Is the template already set to Halloween?", answer: "No. It starts on the next Saturday. Choose your event date and update the arrival and event times before sharing." },
      ],
    },
    prefill: {
      details: {
        title: "Trunk-or-Treat",
        description: "Decorated cars should arrive by 4:30 PM and stay parked until visitors leave at 7:00 PM. Drop candy donations at the welcome table. Follow [your venue's parking instructions].",
        location: "[Your venue] parking lot",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "16:00", endTime: "17:00", days: { kind: "all" }, tasks: [task("Setup helper", 4)] },
        { name: "Decorated cars", startTime: "16:30", endTime: "19:00", days: { kind: "all" }, tasks: [task("Decorated car", 12)] },
        { name: "Welcome table", startTime: "17:00", endTime: "19:00", days: { kind: "all" }, tasks: [task("Welcome helper", 2)] },
        { name: "Candy donations", startTime: "", endTime: "", days: { kind: "all" }, tasks: [task("Bag of individually wrapped candy", 8)] },
        { name: "Cleanup", startTime: "19:00", endTime: "19:30", days: { kind: "all" }, tasks: [task("Cleanup helper", 4)] },
      ],
    },
  },
  {
    slug: "food-pantry-shifts",
    type: "SIGNUP_SHEET",
    name: "Food pantry shifts",
    tagline: "First-Saturday volunteer shifts for six months",
    category: "community",
    icon: "soup",
    seo: {
      title: "Food Pantry Volunteer Sign-Up Sheet — Monthly Shifts",
      description: "Schedule food pantry volunteers on the first Saturday of each month for six months. Sorting, packing and distribution shifts. Free, no accounts.",
      h1: "Food pantry volunteer sign-up sheet",
      intro: [
        "Schedule food pantry volunteers with separate spots for sorting, packing and distribution. This template repeats on the first Saturday of each month for six months, with two shifts per day.",
        "Each month has its own volunteer spots. Change the first date, monthly pattern, times and capacities to match your pantry before sharing with your church, club or neighborhood group.",
      ],
      tips: [
        "Include check-in instructions and any lifting requirements in the description.",
        "Reserve enough time for packing before distribution begins.",
        "Check holiday closures before sharing the six-month schedule.",
      ],
      faqs: [
        { question: "Does this repeat on the first Saturday each month?", answer: "Yes. The starter schedule uses the next first Saturday and repeats monthly for six dates. It follows the weekday's position in the month rather than a fixed day number." },
        { question: "Must volunteers commit to all six months?", answer: "No. Each date has separate spots. Volunteers choose the dates and roles they can cover." },
      ],
    },
    prefill: {
      details: {
        title: "Food Pantry Volunteer Shifts",
        description: "Help prepare and distribute food on the first Saturday of each month. Choose the dates and roles you can cover. Check in at [volunteer entrance]. Contact [organizer] about accessibility or lifting requirements.",
        location: "[Your food pantry]",
        timezone: null,
      },
      anchor: { kind: "monthlyNth", weekday: SAT, ordinal: 1, minOffsetDays: 1 },
      dates: { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 6 } },
      shifts: [
        { name: "Prepare food", startTime: "08:00", endTime: "10:00", days: { kind: "all" }, tasks: [task("Sort donations", 3), task("Pack food bags", 4)] },
        { name: "Distribution", startTime: "10:00", endTime: "12:00", days: { kind: "all" }, tasks: [task("Welcome visitors", 2), task("Distribute food bags", 4), task("Cleanup helper", 2)] },
      ],
    },
  },
  {
    slug: "volunteer",
    type: "SIGNUP_SHEET",
    name: "Volunteer sign-up sheet",
    tagline: "Morning and afternoon roles for any event",
    category: "community",
    icon: "heart",
    seo: {
      title: "Volunteer Sign-Up Sheet — Free Editable Template",
      description: "Create a free volunteer sign-up sheet with morning and afternoon shifts, role limits and a shareable link. No accounts or ads. Edit every role.",
      h1: "Volunteer sign-up sheet",
      intro: [
        "Create a volunteer sign-up sheet by listing the roles, shift times and number of helpers needed. This starter has setup, morning, afternoon and cleanup shifts, with separate spots for welcome and activity helpers.",
        "Rename the roles for your event, adjust capacities and choose a date before sharing the link. Volunteers claim an open spot with their name, and you can export the roster from organizer mode.",
      ],
      tips: [
        "Name roles clearly so volunteers know what they are signing up to do.",
        "Add a check-in location and a contact for questions before the event.",
        "Review open spots before event day and share the link again if help is still needed.",
      ],
      faqs: [
        { question: "Can I change the volunteer roles and shift times?", answer: "Yes. Every role, time and capacity is editable before you create the sheet. Add or remove shifts to match your event." },
        { question: "Do volunteers need an account or email?", answer: "No account is needed. Volunteers enter their name to claim a spot; email is optional. Sign-up names and notes are visible to people with the event link." },
      ],
    },
    prefill: {
      details: {
        title: "Volunteer Sign-Up",
        description: "Choose a role and shift to help with our event. Please arrive ten minutes before your shift and check in at [welcome desk]. Contact [organizer] if you have questions about a role.",
        location: "[Your event venue]",
        timezone: null,
      },
      anchor: nextWeekday(SAT),
      dates: { mode: "single" },
      shifts: [
        { name: "Setup", startTime: "08:00", endTime: "09:00", days: { kind: "all" }, tasks: [task("Setup helper", 4)] },
        { name: "Morning", startTime: "09:00", endTime: "12:00", days: { kind: "all" }, tasks: [task("Welcome desk", 2), task("Activity helper", 4)] },
        { name: "Afternoon", startTime: "12:00", endTime: "15:00", days: { kind: "all" }, tasks: [task("Welcome desk", 2), task("Activity helper", 4)] },
        { name: "Cleanup", startTime: "15:00", endTime: "16:00", days: { kind: "all" }, tasks: [task("Cleanup helper", 4)] },
      ],
    },
  },
  {
    slug: "field-trip-chaperones",
    type: "SIGNUP_SHEET",
    name: "School field trip chaperones",
    tagline: "Chaperone spots for three student groups",
    category: "school",
    icon: "backpack",
    seo: {
      title: "Field Trip Chaperone Sign-Up Sheet — Free Template",
      description: "Organize school field trip chaperones with spots for three groups, trip times and meeting instructions. Free, no accounts or ads. Edit every group.",
      h1: "School field trip chaperone sign-up sheet",
      intro: [
        "Organize field trip chaperones by listing each group and the number of adults needed. This template starts with three groups, two chaperone spots per group and a 9:00 AM to 2:00 PM trip window.",
        "Choose the trip date, rename the groups and adjust times and capacities before sharing with families. Add the destination, meeting point and return instructions in the description so volunteers know what to expect.",
      ],
      tips: [
        "Set the number of chaperone spots using your school's requirements for this trip.",
        "Include the departure time, return time and where chaperones should meet the teacher.",
        "Confirm volunteer requirements with the school and keep student rosters and sensitive information off the shared sheet.",
      ],
      faqs: [
        { question: "Can I change the number of groups and chaperones?", answer: "Yes. Rename, add or remove group roles and adjust the number of spots before creating the sheet. The starter has three groups with two chaperones each." },
        { question: "Does signing up approve a chaperone or collect permission slips?", answer: "No. The sheet coordinates volunteer spots. The school handles chaperone approval and student permission slips separately." },
        { question: "Do parents need an account?", answer: "No. Parents choose a group and enter their name; email is optional. Names and sign-up notes are visible to people with the event link." },
      ],
    },
    prefill: {
      details: {
        title: "School Field Trip Chaperones",
        description: "Please choose a group to chaperone for the full trip. Meet the teacher at [school meeting point] by 8:45 AM. Depart at 9:00 AM for [destination] and return at 2:00 PM. Confirm volunteer requirements with the school before signing up.",
        location: "[School meeting point]",
        timezone: null,
      },
      anchor: nextWeekday(FRI),
      dates: { mode: "single" },
      shifts: [
        { name: "Field trip", startTime: "09:00", endTime: "14:00", days: { kind: "all" }, tasks: [task("Group A chaperone", 2), task("Group B chaperone", 2), task("Group C chaperone", 2)] },
      ],
    },
  },
  // --- Meeting polls --------------------------------------------------------
  {
    slug: "team-meeting",
    type: "TIME_POLL",
    name: "Team meeting",
    tagline: "Morning or afternoon, next week",
    category: "work",
    icon: "briefcase",
    seo: {
      title: "Team Meeting Poll — Find a Time That Works, Free",
      description:
        "Find a meeting time for your team: ten one-hour options across next week, morning and afternoon. Everyone votes Yes, Maybe or No.",
      h1: "Team meeting scheduling poll",
      intro: [
        "Scheduling a meeting over email takes a dozen replies. This poll proposes a morning and an afternoon option on each weekday next week, and everyone marks Yes, Maybe or No for each one.",
        "The best time rises to the top as votes come in. Lock it in, and everyone can add it to their calendar in one click.",
      ],
      tips: [
        "Set the timezone to where most of the team is; the poll converts times for everyone else.",
        "Remove days you already know are busy before sharing — fewer options get faster answers.",
        "Put the agenda in the description so people know how much prep to plan for.",
      ],
      faqs: [
        {
          question: "What's the difference between Yes and Maybe?",
          answer:
            "Yes means the time works. Maybe means it could work if needed. The poll highlights the time with the most support, counting a Yes more than a Maybe.",
        },
        {
          question: "Do people need an account to vote?",
          answer: "No. They open the link, enter their name, and vote.",
        },
      ],
    },
    poll: {
      title: "Team Meeting",
      description: "Pick every time that works for you. Agenda: [topics].",
      anchor: nextWeekday(MON),
      dayOffsets: [0, 1, 2, 3, 4],
      startTimes: ["10:00", "14:00"],
      durationMinutes: 60,
    },
  },
  {
    slug: "book-club",
    type: "TIME_POLL",
    name: "Book club",
    tagline: "Weeknight evenings over two weeks",
    category: "social",
    icon: "book-open",
    seo: {
      title: "Book Club Meeting Poll — Free Scheduling Template",
      description:
        "Pick the next book club night: six 90-minute weeknight options over the next two weeks. Members vote Yes, Maybe or No. Free.",
      h1: "Book club scheduling poll",
      intro: [
        "Finding a night when the whole book club is free is its own chapter. This poll offers Tuesday, Wednesday and Thursday evenings over the next two weeks, each a relaxed 90 minutes.",
        "Members vote on every option, and you can see at a glance which night gets the most people around the table.",
      ],
      tips: [
        "Name the book and the chapters to finish in the description.",
        "Rotate hosts by putting the host's name in each option's label.",
        "Lock the winning night so everyone gets it on their calendar.",
      ],
      faqs: [
        {
          question: "Can I add weekend options?",
          answer: "Yes. Add or change options before creating the poll — each one is just a day and a start time.",
        },
        {
          question: "Can members change their vote later?",
          answer: "Yes. Members who leave an email can come back and update their answers.",
        },
      ],
    },
    poll: {
      title: "Book Club",
      description: "This month we're reading [book]. Pick every night that works for you!",
      anchor: nextWeekday(TUE),
      dayOffsets: [0, 1, 2, 7, 8, 9],
      startTimes: ["19:00"],
      durationMinutes: 90,
    },
  },
  {
    slug: "pickup-soccer",
    type: "TIME_POLL",
    name: "Pickup soccer",
    tagline: "Evening games over the next week",
    category: "sports",
    icon: "trophy",
    seo: {
      title: "Pickup Soccer Game Poll — Find the Best Night, Free",
      description:
        "Get enough players for pickup soccer: vote on 90-minute evening games over the next seven days. Free, no accounts or apps.",
      h1: "Pickup soccer scheduling poll",
      intro: [
        "Pickup games only happen when enough people show up. This poll offers a 6:00 PM game on each of the next seven evenings, and players vote on the nights they can make.",
        "The night with the most Yes votes is your game. Lock it in so everyone gets the time and field on their calendar.",
      ],
      tips: [
        "Put the field and what to bring (both shirt colors, water) in the description.",
        "Share the poll a few days ahead; last-minute polls get fewer players.",
        "Keep the poll going for weekly games by making a copy each week.",
      ],
      faqs: [
        {
          question: "How do I know if enough people are coming?",
          answer: "Each option shows how many people voted Yes and Maybe, so you can see whether you have enough for a game.",
        },
        {
          question: "Can I use this for basketball or volleyball?",
          answer: "Yes. Change the title, duration and location — the poll works for any game.",
        },
      ],
    },
    poll: {
      title: "Pickup Soccer",
      description: "Which nights can you play? Bring a light and a dark shirt, and water.",
      anchor: { kind: "offset", offsetDays: 1 },
      dayOffsets: [0, 1, 2, 3, 4, 5, 6],
      startTimes: ["18:00"],
      durationMinutes: 90,
    },
  },
  {
    slug: "board-game-night",
    type: "TIME_POLL",
    name: "Board game night",
    tagline: "Friday or Saturday, the next two weekends",
    category: "social",
    icon: "dice",
    seo: {
      title: "Game Night Poll — Pick a Date With Friends, Free",
      description:
        "Plan a board game night: vote on Friday and Saturday evenings over the next two weekends. Free, no accounts, no ads.",
      h1: "Board game night scheduling poll",
      intro: [
        "Game night is easy to suggest and hard to schedule. This poll offers Friday and Saturday evenings over the next two weekends, each a three-hour block, so friends can vote on what works.",
        "Once the best night is clear, lock it in and everyone can add it to their calendar.",
      ],
      tips: [
        "Ask people to note which games they'll bring in the description or group chat.",
        "Put the host's address in the location only if you're comfortable with anyone who has the link seeing it.",
        "Plan snacks separately with a potluck sign-up sheet.",
      ],
      faqs: [
        {
          question: "Can I add weeknight options?",
          answer: "Yes. Add any day and time before creating the poll.",
        },
        {
          question: "Is there a limit to how many friends can vote?",
          answer: "No practical limit for a game night — invite as many people as you like.",
        },
      ],
    },
    poll: {
      title: "Board Game Night",
      description: "Which night works for game night? Bring a favorite game if you have one.",
      anchor: nextWeekday(FRI),
      dayOffsets: [0, 1, 7, 8],
      startTimes: ["19:00"],
      durationMinutes: 180,
    },
  },
  {
    slug: "winery-visit",
    type: "TIME_POLL",
    name: "Winery visit",
    tagline: "Weekend afternoons over three weekends",
    category: "social",
    icon: "wine",
    seo: {
      title: "Group Outing Poll — Plan a Winery Visit, Free",
      description:
        "Plan a group winery visit or day trip: vote on Saturday and Sunday afternoons over the next three weekends. Free, no accounts.",
      h1: "Winery visit scheduling poll",
      intro: [
        "Group outings need a date that works for everyone and enough notice to book a tasting. This poll offers Saturday and Sunday afternoons over the next three weekends, each a three-hour block.",
        "Once votes are in, lock the winning date and share it — everyone can add it to their calendar in one click.",
      ],
      tips: [
        "Book the tasting as soon as the date is locked; weekend slots fill up.",
        "Sort out designated drivers or a ride share in the description.",
        "Use a second poll to pick between a couple of wineries if the group is undecided.",
      ],
      faqs: [
        {
          question: "Can I use this for other day trips?",
          answer: "Yes. Change the title, time and location for a hike, museum visit or any group outing.",
        },
        {
          question: "What if the group is in different timezones?",
          answer: "The poll shows each option in every voter's own timezone, so nobody has to do the math.",
        },
      ],
    },
    poll: {
      title: "Winery Visit",
      description: "Let's plan a winery afternoon! Vote for every weekend date that works.",
      anchor: nextWeekday(SAT),
      dayOffsets: [0, 1, 7, 8, 14, 15],
      startTimes: ["12:00"],
      durationMinutes: 180,
    },
  },
  {
    slug: "happy-hour",
    type: "TIME_POLL",
    name: "Happy hour",
    tagline: "Thursday or Friday after work, two weeks",
    category: "work",
    icon: "beer",
    seo: {
      title: "Happy Hour Poll — Pick an After-Work Date, Free",
      description:
        "Plan an after-work happy hour: vote on Thursday and Friday evenings over the next two weeks. Free, no accounts, no group-chat back-and-forth.",
      h1: "Happy hour scheduling poll",
      intro: [
        "An after-work happy hour falls apart when the thread fills up with \"Thursday works for me\" and \"not this week\". This poll offers Thursday and Friday evenings over the next two weeks, starting at 5:30 PM for two hours, so coworkers or friends can mark what works in one place.",
        "The evening with the most support is easy to spot. Lock it in and everyone gets the time and place on their calendar.",
      ],
      tips: [
        "Pick the place before sharing, or say you'll choose it once you know the headcount.",
        "Share the poll a week ahead — Friday evenings fill up fast.",
        "If some people work remotely, set the location to somewhere central or add a video link for a virtual round.",
      ],
      faqs: [
        {
          question: "Can people vote without an account?",
          answer: "Yes. They open the link, enter their name, and mark Yes, Maybe or No for each evening.",
        },
        {
          question: "Can I add a Wednesday option?",
          answer: "Yes. Add, remove or change any option before creating the poll.",
        },
      ],
    },
    poll: {
      title: "Happy Hour",
      description: "Drinks after work! Vote for every evening that works for you. Place: [bar or restaurant].",
      anchor: nextWeekday(THU),
      dayOffsets: [0, 1, 7, 8],
      startTimes: ["17:30"],
      durationMinutes: 120,
    },
  },
  {
    slug: "pta-meeting",
    type: "TIME_POLL",
    name: "PTA meeting",
    tagline: "Weeknight evenings over two weeks",
    category: "school",
    icon: "presentation",
    seo: {
      title: "PTA Meeting Poll — Find a Night That Works, Free",
      description:
        "Schedule a PTA, PTO or school board meeting: members vote on six weeknight evenings over the next two weeks. Free, no accounts needed.",
      h1: "PTA meeting scheduling poll",
      intro: [
        "Parent volunteers juggle work, practices and bedtimes, so a meeting night that suits everyone is hard to guess. This poll offers Tuesday, Wednesday and Thursday evenings at 7:00 PM over the next two weeks, one hour each.",
        "Board members and parents vote on every option, and the best night shows up at a glance. It works just as well for PTO, booster club or school committee meetings.",
      ],
      tips: [
        "Put the agenda in the description so people know whether it's a quick check-in or a planning session.",
        "Add a video link as the location if some members join remotely.",
        "Check the school calendar for concerts and games before sharing — then remove those nights.",
      ],
      faqs: [
        {
          question: "Can I use this for a PTO or booster club?",
          answer: "Yes. Change the title and description — the poll works for any school group.",
        },
        {
          question: "What happens after everyone votes?",
          answer:
            "You lock the winning time, and members can add it to Google Calendar or download an .ics file for Apple Calendar or Outlook.",
        },
      ],
    },
    poll: {
      title: "PTA Meeting",
      description: "Which evening works for our next meeting? Agenda: [topics]. Location: [school library or video link].",
      anchor: nextWeekday(TUE),
      dayOffsets: [0, 1, 2, 7, 8, 9],
      startTimes: ["19:00"],
      durationMinutes: 60,
    },
  },
  {
    slug: "family-reunion",
    type: "TIME_POLL",
    name: "Family reunion",
    tagline: "Weekend afternoons a few weeks out",
    category: "social",
    icon: "house",
    seo: {
      title: "Family Reunion Poll — Pick the Date Together, Free",
      description:
        "Find a family reunion date that works for everyone: vote on weekend afternoons three to five weeks out. Free, no accounts, easy for all ages.",
      h1: "Family reunion scheduling poll",
      intro: [
        "Family reunions need a date that works for relatives in different towns, schedules and generations. This poll offers Saturday and Sunday afternoons three, four and five weekends from now, so people have time to plan travel.",
        "Relatives vote with just their name — nothing to install — and you can see which weekend brings the most of the family together.",
      ],
      tips: [
        "Ask one person per household to vote so the counts reflect families, not individuals — or ask everyone, and note it in the description.",
        "Move the options further out if people need to book flights.",
        "Once the date is locked, plan the food with a potluck sign-up sheet.",
      ],
      faqs: [
        {
          question: "Relatives live in different time zones. Is that a problem?",
          answer: "No. Each option is shown in every voter's own time zone.",
        },
        {
          question: "Can older relatives vote without an account?",
          answer: "Yes. They open the link, type their name, and tap Yes, Maybe or No. No app or password.",
        },
      ],
    },
    poll: {
      title: "Family Reunion",
      description: "Let's pick a weekend to get the whole family together! Vote for every date that could work.",
      anchor: nextWeekday(SAT),
      dayOffsets: [14, 15, 21, 22, 28, 29],
      startTimes: ["13:00"],
      durationMinutes: 240,
    },
  },
  {
    slug: "neighborhood-get-together",
    type: "TIME_POLL",
    name: "Neighborhood get-together",
    tagline: "Saturday late morning or afternoon",
    category: "community",
    icon: "tent",
    seo: {
      title: "Neighborhood Get-Together Poll — Block Party Date",
      description:
        "Plan a block party, street picnic or neighborhood social: neighbors vote on Saturday late mornings and afternoons over three weekends. Free.",
      h1: "Neighborhood get-together scheduling poll",
      intro: [
        "A block party or street picnic works best when most of the street can come. This poll offers a late-morning and an afternoon option on each of the next three Saturdays, so neighbors can say what fits around sports, errands and naps.",
        "Share the link in your neighborhood group or on a flyer with a QR code, and see which Saturday gets the most yeses.",
      ],
      tips: [
        "Print the event's QR code on a flyer for neighbors who aren't in the group chat.",
        "Check whether your area needs a permit to close the street, and allow time for it.",
        "After the date is set, use a sign-up sheet for grills, tables and dishes.",
      ],
      faqs: [
        {
          question: "Can neighbors vote without giving their email?",
          answer: "Yes. A name is enough. An email is optional and only used to send them a link to change their vote.",
        },
        {
          question: "Can I share the poll on paper?",
          answer: "Yes. Every event has a QR code you can print, which opens the poll on a phone.",
        },
      ],
    },
    poll: {
      title: "Neighborhood Get-Together",
      description: "Let's get the street together! Vote for every Saturday time that works. Kids and dogs welcome.",
      anchor: nextWeekday(SAT),
      dayOffsets: [0, 7, 14],
      startTimes: ["11:00", "16:00"],
      durationMinutes: 180,
    },
  },
  {
    slug: "band-rehearsal",
    type: "TIME_POLL",
    name: "Band rehearsal",
    tagline: "Evenings this week, Saturday included",
    category: "social",
    icon: "music",
    seo: {
      title: "Band Rehearsal Poll — Find a Practice Time, Free",
      description:
        "Get the whole band in one room: vote on two-hour evening rehearsal slots this week, Saturday included. Works for bands, choirs and ensembles. Free.",
      h1: "Band rehearsal scheduling poll",
      intro: [
        "A rehearsal is only useful when everyone shows up. This poll offers two-hour evening slots Monday through Thursday and on Saturday this week, and each member marks what they can make.",
        "It works for a garage band, a choir section or a community orchestra — anywhere one missing player means rescheduling.",
      ],
      tips: [
        "Put the set list or pieces to practice in the description so people come prepared.",
        "If you rent a room, check which slots are free before you share the poll.",
        "Make a copy of the poll each week to keep a regular rehearsal going.",
      ],
      faqs: [
        {
          question: "Can I see who can't make a slot?",
          answer: "Yes. Every vote is listed by name, so you can see exactly who marked No or Maybe.",
        },
        {
          question: "Can I reuse the same poll every week?",
          answer: "Use Make a copy on the poll's page: you get the same times moved to the coming days, with no votes.",
        },
      ],
    },
    poll: {
      title: "Band Rehearsal",
      description: "When can everyone rehearse this week? We'll work on: [songs or pieces]. Room: [location].",
      anchor: nextWeekday(MON),
      dayOffsets: [0, 1, 2, 3, 5],
      startTimes: ["19:00"],
      durationMinutes: 120,
    },
  },
  {
    slug: "committee-meeting",
    type: "TIME_POLL",
    name: "Committee meeting",
    tagline: "Find a weeknight time for your volunteer committee",
    category: "community",
    icon: "presentation",
    seo: {
      title: "Committee Meeting Poll — Find a Time, Free",
      description: "Find a committee meeting time with six weeknight options and Yes, Maybe or No voting. Lock the chosen time when ready. Free, no accounts or ads.",
      h1: "Committee meeting scheduling poll",
      intro: [
        "Find a committee meeting time by offering several options and asking each member to vote Yes, Maybe or No. This template offers six one-hour options on Monday, Tuesday and Wednesday evenings next week.",
        "Edit the dates and times for your volunteer committee, then share one link. Compare availability and lock the chosen time when the group is ready; members can add it to their calendars.",
      ],
      tips: [
        "Include a short agenda so members know what the meeting will cover.",
        "Ask everyone to vote on all options, including times they cannot attend.",
        "Give members a response deadline before choosing and locking the time.",
      ],
      faqs: [
        { question: "Can members vote without an account?", answer: "Yes. Members open the link, enter their name and vote Yes, Maybe or No on each option. Email is optional." },
        { question: "Does the poll automatically schedule recurring meetings?", answer: "No. This poll chooses a time for one meeting. Create another poll or copy the event when you need to find a new meeting time." },
      ],
    },
    poll: {
      title: "Committee Meeting",
      description: "Let's find an hour for our committee meeting. Vote on every option by [response deadline]. Agenda: [topics].",
      anchor: nextWeekday(MON),
      dayOffsets: [0, 1, 2],
      startTimes: ["18:00", "19:30"],
      durationMinutes: 60,
    },
  },
];

/** Breadcrumb name for /templates — the words people search for, not "Templates". */
export const TEMPLATES_HUB_NAME = "Sign-up sheet & poll templates";

/**
 * Footer links to a handful of templates, with search-friendly anchor text.
 * Picked by likely search demand, not usage data — revisit once Search
 * Console shows which template pages actually get impressions.
 */
export const POPULAR_TEMPLATE_LINKS: Array<{ label: string; path: string }> = [
  ["potluck", "Potluck sign-up sheet"],
  ["staff-appreciation-week", "Staff appreciation week"],
  ["parent-teacher-conferences", "Parent–teacher conference sign-up"],
  ["meal-train", "Meal train"],
  ["concession-stand", "Concession stand schedule"],
  ["team-meeting", "Team meeting poll"],
].map(([slug, label]) => ({ label, path: templatePath(getTemplate(slug)!) }));

/**
 * The short list the header menu shows; the hub (/templates) lists them all.
 * Kept small on purpose so the header doesn't turn into a site map.
 */
export const HEADER_MENU_SLUGS = [
  // Five of each type, picked by likely search demand (no usage data yet).
  "book-fair",
  "meal-train",
  "parent-teacher-conferences",
  "staff-appreciation-week",
  "bake-sale",
  "team-meeting",
  "family-reunion",
  "book-club",
  "happy-hour",
  "pta-meeting",
];

export function getTemplate(slug: string | null | undefined): EventTemplate | null {
  if (!slug) return null;
  return TEMPLATES.find((t) => t.slug === slug) ?? null;
}

export function templatePath(t: EventTemplate): string {
  return `/${t.type === "TIME_POLL" ? "meeting-poll" : "signup-sheet"}/${t.slug}`;
}

export function templateCreatePath(t: EventTemplate): string {
  return `/create/${t.type === "TIME_POLL" ? "poll" : "signup"}?template=${encodeURIComponent(t.slug)}`;
}

export function signupPrefillFromTemplate(t: SignupTemplate): SignupPrefill {
  return { source: { kind: "template", slug: t.slug, name: t.name }, ...t.prefill };
}

export function pollPrefillFromTemplate(t: PollTemplate): PollPrefill {
  return {
    source: { kind: "template", slug: t.slug, name: t.name },
    details: { title: t.poll.title, description: t.poll.description, location: "", timezone: null },
    anchor: t.poll.anchor,
    durationMinutes: t.poll.durationMinutes,
    options: t.poll.dayOffsets.flatMap((dayOffset) =>
      t.poll.startTimes.map((startTime) => ({ dayOffset, startTime, label: "" }))
    ),
    notes: [],
  };
}

/** Three other templates to link from a template page: same category first. */
export function relatedTemplates(t: EventTemplate, count = 3): EventTemplate[] {
  const others = TEMPLATES.filter((o) => o.slug !== t.slug);
  return [
    ...others.filter((o) => o.category === t.category),
    ...others.filter((o) => o.category !== t.category && o.type === t.type),
    ...others.filter((o) => o.category !== t.category && o.type !== t.type),
  ].slice(0, count);
}

// ---------------------------------------------------------------------------
// Words for the template pages. Templates have no fixed dates, so the pages
// describe the pattern ("5 days in a row, from the next Monday") instead of
// showing dates that would go stale.
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function anchorPhrase(anchor: RelativeAnchor): string {
  if (anchor.kind === "weekday") return `the next ${WEEKDAY_NAMES[anchor.weekday]}`;
  if (anchor.kind === "offset") return anchor.offsetDays === 1 ? "tomorrow" : `in ${anchor.offsetDays} days`;
  return "your first date";
}

/** The day name `offset` days after the anchor, when the anchor is a weekday. */
function dayName(anchor: RelativeAnchor, offset: number): string {
  return anchor.kind === "weekday" ? WEEKDAY_NAMES[(anchor.weekday + offset) % 7] : `Day ${offset + 1}`;
}

/** "5 days in a row, from the next Monday", "Every Friday, 8 times", … */
export function describeTemplateSchedule(t: EventTemplate): string {
  if (t.type === "TIME_POLL") {
    const count = t.poll.dayOffsets.length * t.poll.startTimes.length;
    return `${count} options, ${formatDurationLabel(t.poll.durationMinutes)} each, from ${anchorPhrase(t.poll.anchor)}`;
  }
  const { anchor, dates } = t.prefill;
  if (dates.mode === "single") return `One day, on ${anchorPhrase(anchor)}`;
  if (dates.mode === "range") return `${dates.spanDays} days in a row, from ${anchorPhrase(anchor)}`;
  const rule = dates.rule;
  const every =
    rule.type === "daily"
      ? "Every day"
      : rule.type === "weekdays"
        ? "Every weekday"
        : rule.type === "weekly"
          ? `${rule.interval > 1 ? `Every ${rule.interval} weeks on` : "Every"} ${listWords(rule.weekdays.map((w) => WEEKDAY_NAMES[w]))}`
          : `Monthly`;
  const ends =
    "after" in dates.ends
      ? `${dates.ends.after} times`
      : "untilMonthDay" in dates.ends
        ? `until ${MONTH_NAMES[Number(dates.ends.untilMonthDay.slice(0, 2)) - 1]} ${Number(dates.ends.untilMonthDay.slice(3))}`
        : `for ${dates.ends.offsetDays + 1} days`;
  return `${every}, ${ends}, from ${anchorPhrase(anchor)}`;
}

/** Which days a template shift runs on, in words ("" = the sheet's only day). */
export function describeShiftDays(t: SignupTemplate, days: RelativeDayFilter): string {
  if (days.kind === "all") {
    const dates = t.prefill.dates;
    if (dates.mode === "single") return "";
    if (dates.mode === "range" || dates.rule.type === "daily") return "Every day";
    if (dates.rule.type === "weekdays") return "Monday to Friday";
    if (dates.rule.type === "weekly") return listWords(dates.rule.weekdays.map((w) => WEEKDAY_NAMES[w]));
    return "Every date";
  }
  if (days.kind === "weekdays") return listWords(days.values.map((w) => WEEKDAY_NAMES[w]));
  return listWords(days.values.map((o) => dayName(t.prefill.anchor, o)));
}

/** "Monday · 10:00 AM", or "Day 1 · 6:00 PM" when the poll starts tomorrow. */
export function describePollOptions(t: PollTemplate): string[] {
  return t.poll.dayOffsets.flatMap((o) =>
    t.poll.startTimes.map((time) => {
      const week = t.poll.anchor.kind === "weekday" && o >= 7 ? ` (week ${Math.floor(o / 7) + 1})` : "";
      return `${dayName(t.poll.anchor, o)}${week} · ${formatTimeDisplay(time)}`;
    })
  );
}
