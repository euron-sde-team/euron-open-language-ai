/**
 * Demo practice sessions: transcripts, corrections, vocabulary and scores written by hand
 * so a fresh install shows what a finished lesson looks like. Everyone in them is fictional.
 */
import type { CorrectionType, LessonScores, TranscriptLine } from "@open-language/types";

export interface DemoSession {
  scenario: string | null;
  daysAgo: number;
  minutes: number;
  scores: LessonScores;
  summary: string;
  transcript: TranscriptLine[];
  corrections: { type: CorrectionType; original: string; corrected: string; explanation: string }[];
  vocab: { phrase: string; meaning: string; example?: string }[];
}

const t = (text: string): TranscriptLine => ({ role: "tutor", text });
const l = (text: string): TranscriptLine => ({ role: "learner", text });

/** Lee's six sessions, oldest first: native English, target Spanish, level B1. */
export const LEE_SESSIONS: DemoSession[] = [
  {
    scenario: "Ordering food",
    daysAgo: 20,
    minutes: 6,
    scores: { fluency: 4, accuracy: 5, vocabRange: 5, confidence: 4 },
    summary: "Pediste una comida y una bebida en un restaurante. Usaste frases cortas y necesitaste ayuda con los verbos.",
    transcript: [
      t("¡Buenas tardes! Bienvenido. (Good afternoon! Welcome.) ¿Qué desea tomar? (What would you like to drink?)"),
      l("Yo quiero agua, por favor."),
      t("¡Perfecto! (Perfect!) ¿Y para comer? (And to eat?)"),
      l("Yo querer la paella."),
      t("Casi. Small note: se dice «quiero la paella». (Almost. Small note: you say \"I want the paella\".) ¿Algo más? (Anything else?)"),
      l("No, gracias. La cuenta, por favor."),
    ],
    corrections: [{ type: "grammar", original: "Yo querer la paella", corrected: "Yo quiero la paella", explanation: "Conjugate the verb: querer becomes quiero after yo." }],
    vocab: [
      { phrase: "¿Qué desea tomar?", meaning: "What would you like to drink?" },
      { phrase: "La cuenta, por favor", meaning: "The check, please" },
      { phrase: "¿Algo más?", meaning: "Anything else?" },
    ],
  },
  {
    scenario: "Asking directions",
    daysAgo: 16,
    minutes: 7,
    scores: { fluency: 5, accuracy: 5, vocabRange: 5, confidence: 5 },
    summary: "Preguntaste cómo llegar a la estación de tren. Entendiste las direcciones básicas: derecha, izquierda y todo recto.",
    transcript: [
      t("Hola. ¿Necesita ayuda? (Hello. Do you need help?)"),
      l("Sí, dónde está la estación de tren?"),
      t("Siga todo recto y gire a la derecha. (Go straight and turn right.) Está a cinco minutos. (It is five minutes away.)"),
      l("Gracias. Es lejos de aquí?"),
      t("No, está muy cerca. (No, it is very close.) ¿Algo más? (Anything else?)"),
      l("No, muchas gracias. Adiós."),
    ],
    corrections: [{ type: "grammar", original: "dónde está la estación de tren?", corrected: "¿Dónde está la estación de tren?", explanation: "Spanish questions open with an inverted question mark." }],
    vocab: [
      { phrase: "Siga todo recto", meaning: "Go straight ahead" },
      { phrase: "Gire a la derecha", meaning: "Turn right" },
      { phrase: "Está muy cerca", meaning: "It is very close" },
      { phrase: "a cinco minutos", meaning: "five minutes away" },
    ],
  },
  {
    scenario: "Hotel check-in",
    daysAgo: 11,
    minutes: 8,
    scores: { fluency: 6, accuracy: 5, vocabRange: 6, confidence: 5 },
    summary: "Hiciste el registro en un hotel: diste tu nombre, confirmaste las noches y preguntaste por el desayuno.",
    transcript: [
      t("Buenas noches. ¿Tiene una reserva? (Good evening. Do you have a reservation?)"),
      l("Sí, tengo una reserva a nombre de Lee."),
      t("Perfecto. ¿Cuántas noches se queda? (Perfect. How many nights are you staying?)"),
      l("Yo me quedo tres noches. A qué hora es el desayuno?"),
      t("El desayuno es de siete a diez. (Breakfast is from seven to ten.)"),
      l("Muy bien. Y la contraseña del WiFi, por favor?"),
      t("Está en la tarjeta de la habitación. (It is on the room card.)"),
    ],
    corrections: [
      { type: "word_choice", original: "Yo me quedo tres noches", corrected: "Me quedo tres noches", explanation: "The subject pronoun is usually dropped; the verb ending already says who." },
      { type: "pronunciation", original: "desayuno", corrected: "desayuno (de-sa-YU-no)", explanation: "Stress the second to last syllable: de-sa-YU-no." },
    ],
    vocab: [
      { phrase: "¿Tiene una reserva?", meaning: "Do you have a reservation?" },
      { phrase: "¿Cuántas noches se queda?", meaning: "How many nights are you staying?" },
      { phrase: "la contraseña del WiFi", meaning: "the WiFi password" },
      { phrase: "la tarjeta de la habitación", meaning: "the room card" },
      { phrase: "Me quedo tres noches", meaning: "I am staying three nights" },
    ],
  },
  {
    scenario: "Small talk with a coworker",
    daysAgo: 3,
    minutes: 9,
    scores: { fluency: 7, accuracy: 6, vocabRange: 6, confidence: 7 },
    summary: "Hablaste con un compañero sobre el fin de semana. Tus frases fueron más largas y casi sin pausas.",
    transcript: [
      t("¡Hola! ¿Qué tal tu fin de semana? (Hi! How was your weekend?)"),
      l("Fue muy bueno. Fui a la playa con mis amigos y comimos mariscos."),
      t("¡Qué bien! (How nice!) ¿Hizo buen tiempo? (Was the weather good?)"),
      l("Sí, hacía mucho sol, pero el agua estaba fría."),
      t("¡Muy bien dicho! (Very well said!) ¿Y este fin de semana qué planes tienes? (And what are your plans this weekend?)"),
      l("Voy a estudiar para mi examen y tal vez ir al cine."),
      t("Suena perfecto. (Sounds perfect.)"),
    ],
    corrections: [{ type: "word_choice", original: "comimos mariscos", corrected: "comimos marisco", explanation: "Marisco is used as a mass noun when you talk about eating seafood in general." }],
    vocab: [
      { phrase: "¿Qué tal tu fin de semana?", meaning: "How was your weekend?" },
      { phrase: "Hacía mucho sol", meaning: "It was very sunny" },
      { phrase: "¿Qué planes tienes?", meaning: "What are your plans?" },
      { phrase: "tal vez", meaning: "maybe" },
    ],
  },
  {
    scenario: "Phone call to support",
    daysAgo: 2,
    minutes: 8,
    scores: { fluency: 7, accuracy: 7, vocabRange: 7, confidence: 6 },
    summary: "Llamaste a atención al cliente por un paquete retrasado. Explicaste el problema con claridad y pediste una solución.",
    transcript: [
      t("Atención al cliente, buenos días. ¿En qué puedo ayudarle? (Customer service, good morning. How can I help you?)"),
      l("Buenos días. Mi paquete no ha llegado todavía y debía llegar el lunes."),
      t("Lo siento mucho. (I am very sorry.) ¿Me da su número de pedido? (Can you give me your order number?)"),
      l("Sí, es el cuatro, siete, uno, nueve."),
      t("Gracias. Veo que hubo un retraso. (Thank you. I see there was a delay.) Llegará mañana. (It will arrive tomorrow.)"),
      l("Perfecto, muchas gracias por su ayuda."),
    ],
    corrections: [{ type: "word_choice", original: "Mi paquete no ha llegado todavía", corrected: "Mi paquete todavía no ha llegado", explanation: "Both orders are understood, but todavía no sounds the most natural." }],
    vocab: [
      { phrase: "¿En qué puedo ayudarle?", meaning: "How can I help you?" },
      { phrase: "número de pedido", meaning: "order number" },
      { phrase: "Hubo un retraso", meaning: "There was a delay" },
      { phrase: "Llegará mañana", meaning: "It will arrive tomorrow" },
    ],
  },
  {
    scenario: "Job interview",
    daysAgo: 1,
    minutes: 11,
    scores: { fluency: 8, accuracy: 7, vocabRange: 7, confidence: 8 },
    summary: "Practicaste una entrevista de trabajo: hablaste de tu experiencia y de un reto que superaste, con buena seguridad.",
    transcript: [
      t("Bienvenido a la entrevista. (Welcome to the interview.) Cuénteme sobre su experiencia. (Tell me about your experience.)"),
      l("Trabajo como ingeniero de software desde hace cinco años. He trabajado en equipos pequeños y grandes."),
      t("Interesante. (Interesting.) ¿Cuál fue un reto difícil que superó? (What was a hard challenge you overcame?)"),
      l("Una vez migramos una base de datos sin parar el servicio. Fue difícil, pero lo logramos en equipo."),
      t("¡Excelente! (Excellent!) ¿Por qué quiere este trabajo? (Why do you want this job?)"),
      l("Porque me gusta aprender cosas nuevas y su empresa tiene proyectos muy interesantes."),
    ],
    corrections: [{ type: "pronunciation", original: "ingeniero", corrected: "ingeniero (in-he-NIE-ro)", explanation: "The g before e sounds like an English h." }],
    vocab: [
      { phrase: "desde hace cinco años", meaning: "for five years" },
      { phrase: "un reto difícil", meaning: "a hard challenge" },
      { phrase: "lo logramos en equipo", meaning: "we managed it as a team" },
      { phrase: "aprender cosas nuevas", meaning: "to learn new things" },
      { phrase: "Cuénteme sobre su experiencia", meaning: "Tell me about your experience" },
    ],
  },
];

/** A few sessions for the other demo accounts, so the admin lists have rows. */
export const OTHER_SESSIONS: { language: string; level: "A1" | "A2" | "B1" | "B2"; native: string; sessions: Omit<DemoSession, "transcript" | "corrections" | "vocab">[] }[] = [
  {
    language: "fr",
    level: "A2",
    native: "en",
    sessions: [
      { scenario: "Ordering food", daysAgo: 12, minutes: 5, scores: { fluency: 4, accuracy: 4, vocabRange: 4, confidence: 5 }, summary: "Vous avez commandé un repas au restaurant avec des phrases courtes." },
      { scenario: "Hotel check-in", daysAgo: 4, minutes: 7, scores: { fluency: 6, accuracy: 5, vocabRange: 5, confidence: 6 }, summary: "Vous vous êtes présenté à la réception et avez demandé l'heure du petit déjeuner." },
    ],
  },
  {
    language: "de",
    level: "B1",
    native: "hi",
    sessions: [{ scenario: null, daysAgo: 8, minutes: 10, scores: { fluency: 6, accuracy: 6, vocabRange: 7, confidence: 6 }, summary: "Sie haben frei über Ihre Arbeit und Ihre Pläne gesprochen." }],
  },
  {
    language: "es",
    level: "A1",
    native: "en",
    sessions: [{ scenario: "Airport immigration", daysAgo: 6, minutes: 4, scores: { fluency: 3, accuracy: 4, vocabRange: 3, confidence: 4 }, summary: "Respondiste a las preguntas del oficial con frases muy cortas." }],
  },
];

/** The learner's deck, beyond what the lessons suggested. `due` cards are scheduled for today or earlier. */
export const EXTRA_VOCAB: { phrase: string; meaning: string; days: number; due: boolean }[] = [
  { phrase: "por favor", meaning: "please", days: 30, due: false },
  { phrase: "gracias", meaning: "thank you", days: 28, due: false },
  { phrase: "¿cuánto cuesta?", meaning: "how much does it cost?", days: 9, due: true },
  { phrase: "no entiendo", meaning: "I do not understand", days: 6, due: true },
  { phrase: "más despacio, por favor", meaning: "more slowly, please", days: 6, due: true },
  { phrase: "me gustaría", meaning: "I would like", days: 3, due: true },
  { phrase: "la reserva", meaning: "the reservation", days: 2, due: true },
  { phrase: "con mucho gusto", meaning: "with pleasure", days: 4, due: true },
  { phrase: "lo siento", meaning: "I am sorry", days: 2, due: true },
];
