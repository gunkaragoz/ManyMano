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
  | "package"
  | "soup"
  | "briefcase"
  | "book-open"
  | "trophy"
  | "dice"
  | "wine";

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
    slug: "food-pantry-volunteers",
    type: "SIGNUP_SHEET",
    name: "Food pantry volunteers",
    tagline: "Tuesday sorting, Tuesday and Saturday distribution",
    category: "community",
    icon: "package",
    seo: {
      title: "Food Pantry Volunteer Schedule — Free Sign-Up Template",
      description:
        "Schedule food pantry volunteers twice a week: sorting on Tuesdays and distribution on Tuesdays and Saturdays. Repeats for six weeks. Free.",
      h1: "Food pantry volunteer schedule",
      intro: [
        "Recurring volunteer schedules are where paper sign-up sheets fall apart. This template repeats every Tuesday and Saturday for six weeks, with a sorting shift that only runs on Tuesdays and a distribution shift on both days.",
        "Volunteers see the whole schedule and pick the days they can make; you see where the gaps are before the week starts.",
      ],
      tips: [
        "Ask first-time volunteers to note it in their sign-up so a regular can show them around.",
        "Put parking and entrance details in the location so nobody waits at the wrong door.",
        "Extend the repeat when the six weeks are up, or create a copy for the next season.",
      ],
      faqs: [
        {
          question: "Can the sorting shift run on Saturdays too?",
          answer: "Yes. Every shift can run on all of the sheet's weekdays or only some — change it under the shift before creating the sheet.",
        },
        {
          question: "What happens after six weeks?",
          answer:
            "The sheet ends after its last date. Use Make a copy on the event page to start the next run with the same shifts.",
        },
      ],
    },
    prefill: {
      details: {
        title: "Food Pantry Volunteers",
        description:
          "Thank you for helping neighbors in need. Closed-toe shoes please. First time? Add a note and someone will show you around.",
        location: "[Pantry address]",
        timezone: null,
      },
      anchor: nextWeekday(TUE),
      dates: { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [TUE, SAT] }, ends: { after: 12 } },
      shifts: [
        { name: "Sorting", startTime: "09:00", endTime: "11:00", days: { kind: "weekdays", values: [TUE] }, tasks: [task("Sort donations", 4), task("Check dates and stock shelves", 2)] },
        { name: "Distribution", startTime: "11:00", endTime: "13:00", days: { kind: "all" }, tasks: [task("Greeter and check-in", 1), task("Pack bags", 3), task("Carry-out helper", 2)] },
      ],
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
].map(([slug, label]) => ({ label, path: `/templates/${slug}` }));

export function getTemplate(slug: string | null | undefined): EventTemplate | null {
  if (!slug) return null;
  return TEMPLATES.find((t) => t.slug === slug) ?? null;
}

export function templatePath(t: EventTemplate): string {
  return `/templates/${t.slug}`;
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
  const ends = "after" in dates.ends ? `${dates.ends.after} times` : `for ${dates.ends.offsetDays + 1} days`;
  return `${every}, ${ends}, from ${anchorPhrase(anchor)}`;
}

/** Which days a template shift runs on, in words ("" = the sheet's only day). */
export function describeShiftDays(t: SignupTemplate, days: RelativeDayFilter): string {
  if (days.kind === "all") return t.prefill.dates.mode === "single" ? "" : "Every day";
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
