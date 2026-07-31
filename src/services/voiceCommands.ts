/**
 * Vernacular voice command layer — the accessibility moat.
 *
 * A large share of Indian truck drivers read little or no English, and many
 * read no script fluently at all. Every competitor ships a form-driven app;
 * the driver who can run the whole thing by speaking is the driver who
 * stays. This module owns the language half of that: matching what was said
 * (in Hindi, Punjabi, Telugu, Tamil, Hinglish or English) to an intent, and
 * composing the spoken reply in the same language.
 *
 * Matching is keyword-based rather than an NLU service on purpose: it works
 * offline in a cab with no signal, costs nothing per utterance, and is
 * debuggable by a human who speaks the language. Romanised spellings are
 * included because that is how drivers actually type and how most speech
 * recognisers transliterate.
 *
 * The recogniser itself is the one piece that needs a dev build (see
 * services/voice.ts `listen`); everything here is testable without it.
 */

import type { Locale } from '../types';

export type VoiceIntent =
  | 'earnings'
  | 'find_loads'
  | 'fastag_balance'
  | 'savings'
  | 'next_stop'
  | 'breakdown'
  | 'legal_help'
  | 'sos'
  | 'documents'
  | 'help';

/**
 * Keywords per intent, across scripts and their romanisations. Order
 * matters: the first intent with a hit wins, so emergencies are checked
 * before informational queries.
 */
const KEYWORDS: { intent: VoiceIntent; words: string[] }[] = [
  // Emergencies first — a panicking driver must never be misrouted.
  {
    intent: 'sos',
    words: ['sos', 'emergency', 'bachao', 'बचाओ', 'खतरा', 'ਬਚਾਓ', 'help me', 'accident', 'दुर्घटना'],
  },
  {
    intent: 'breakdown',
    words: [
      'breakdown', 'break down', 'kharab', 'खराब', 'गाड़ी खराब', 'ਖਰਾਬ', 'mechanic', 'मैकेनिक',
      'puncture', 'पंचर', 'towing', 'engine', 'इंजन', 'repair', 'मरम्मत',
    ],
  },
  {
    intent: 'legal_help',
    words: [
      'challan', 'चालान', 'ਚਲਾਨ', 'police', 'पुलिस', 'ਪੁਲਿਸ', 'rto', 'आरटीओ', 'lawyer',
      'vakil', 'वकील', 'legal', 'kanoon', 'कानून', 'fine', 'जुर्माना', 'seize', 'जब्त',
    ],
  },
  {
    intent: 'earnings',
    words: [
      'earning', 'earnings', 'kamai', 'कमाई', 'ਕਮਾਈ', 'paisa', 'पैसा', 'payment', 'भुगतान',
      'income', 'salary', 'सैलरी', 'சம்பாத்தியம்', 'సంపాదన',
    ],
  },
  {
    intent: 'savings',
    words: [
      'saving', 'savings', 'bachat', 'बचत', 'ਬਚਤ', 'pension', 'पेंशन', 'ਪੈਨਸ਼ਨ', 'jama', 'जमा',
    ],
  },
  {
    intent: 'fastag_balance',
    words: ['fastag', 'फास्टैग', 'toll', 'टोल', 'ਟੋਲ', 'balance', 'बैलेंस', 'wallet', 'बटुआ'],
  },
  {
    intent: 'find_loads',
    words: [
      'load', 'loads', 'lod', 'लोड', 'ਲੋਡ', 'booking', 'बुकिंग', 'trip', 'ट्रिप', 'kaam', 'काम',
      'work', 'return load', 'वापसी', 'bharai', 'भराई',
    ],
  },
  {
    intent: 'next_stop',
    words: [
      'dhaba', 'ढाबा', 'ਢਾਬਾ', 'stop', 'रुकना', 'khana', 'खाना', 'food', 'rest', 'आराम',
      'petrol', 'पेट्रोल', 'diesel', 'डीजल', 'pump', 'पंप',
    ],
  },
  {
    intent: 'documents',
    words: [
      'document', 'documents', 'kagaz', 'कागज', 'ਕਾਗਜ਼', 'papers', 'rc', 'licence', 'license',
      'लाइसेंस', 'insurance', 'बीमा', 'permit', 'परमिट', 'puc', 'पीयूसी',
    ],
  },
  {
    intent: 'help',
    words: ['help', 'madad', 'मदद', 'ਮਦਦ', 'kya kar sakta', 'options', 'menu', 'सहायता'],
  },
];

/**
 * Match a spoken utterance to an intent. Returns null when nothing matches,
 * so the caller can say "I did not understand" rather than guess — guessing
 * wrong on "police" vs "petrol" is worse than asking again.
 */
export function matchIntent(utterance: string): VoiceIntent | null {
  const text = utterance.toLowerCase().trim();
  if (!text) return null;
  for (const { intent, words } of KEYWORDS) {
    if (words.some((w) => text.includes(w.toLowerCase()))) return intent;
  }
  return null;
}

/** What the mic button offers when tapped — spoken and shown. */
export const INTENT_LABEL: Record<VoiceIntent, string> = {
  earnings: 'My earnings',
  find_loads: 'Find loads',
  fastag_balance: 'FASTag balance',
  savings: 'My savings',
  next_stop: 'Next stop',
  breakdown: 'Breakdown help',
  legal_help: 'Legal help',
  sos: 'Emergency SOS',
  documents: 'My documents',
  help: 'What can I say?',
};

export interface SpokenReply {
  /** Text to speak (and show, for anyone who does read). */
  text: string;
  /** Set when the intent should also navigate or act. */
  action: VoiceIntent;
}

type Phrases = Record<VoiceIntent | 'unknown' | 'greeting', string>;

/**
 * Reply templates per locale. `{}` placeholders are filled by the caller's
 * live data, so the driver hears real numbers, not a menu.
 */
const PHRASES: Record<Locale, Phrases> = {
  en: {
    greeting: 'Yes? Say earnings, loads, FASTag, savings, or help.',
    earnings: 'You have received {received} rupees. {locked} rupees is still held in escrow.',
    find_loads: 'Showing loads out of {city}. The best one pays {best} rupees.',
    fastag_balance: 'Your FASTag balance is {balance} rupees.',
    savings: 'You have saved {savings} rupees, and {pension} rupees in your pension.',
    next_stop: 'The next stop on your route is {stop}.',
    breakdown: 'Sending a mechanic to your location now. Stay with your truck.',
    legal_help: 'Opening legal help. An advocate will call you. Do not pay any cash on the road.',
    sos: 'Emergency alert sent with your location. Help is being arranged.',
    documents: 'Opening your documents. {expiring} document needs renewal.',
    help: 'You can say: my earnings, find loads, FASTag balance, my savings, breakdown, legal help, or emergency.',
    unknown: 'Sorry, I did not understand. Say help to hear what you can ask.',
  },
  hi: {
    greeting: 'बोलिए। कमाई, लोड, फास्टैग, बचत या मदद कहें।',
    earnings: 'आपको {received} रुपये मिल चुके हैं। {locked} रुपये अभी एस्क्रो में हैं।',
    find_loads: '{city} से जाने वाले लोड दिखा रहा हूँ। सबसे अच्छा {best} रुपये का है।',
    fastag_balance: 'आपका फास्टैग बैलेंस {balance} रुपये है।',
    savings: 'आपकी बचत {savings} रुपये है, और पेंशन में {pension} रुपये हैं।',
    next_stop: 'आपके रास्ते में अगला पड़ाव {stop} है।',
    breakdown: 'मैकेनिक आपके पास भेजा जा रहा है। गाड़ी के पास ही रहें।',
    legal_help: 'कानूनी मदद शुरू कर रहा हूँ। वकील आपको फोन करेंगे। सड़क पर नकद न दें।',
    sos: 'आपकी लोकेशन के साथ आपातकालीन सूचना भेज दी गई है। मदद भेजी जा रही है।',
    documents: 'आपके कागज़ खोल रहा हूँ। {expiring} कागज़ का नवीनीकरण ज़रूरी है।',
    help: 'आप कह सकते हैं: मेरी कमाई, लोड ढूंढो, फास्टैग बैलेंस, मेरी बचत, गाड़ी खराब, कानूनी मदद, या आपातकाल।',
    unknown: 'माफ़ कीजिए, समझ नहीं आया। मदद कहें तो विकल्प बताऊँगा।',
  },
  pa: {
    greeting: 'ਦੱਸੋ। ਕਮਾਈ, ਲੋਡ, ਫਾਸਟੈਗ, ਬਚਤ ਜਾਂ ਮਦਦ ਕਹੋ।',
    earnings: 'ਤੁਹਾਨੂੰ {received} ਰੁਪਏ ਮਿਲ ਚੁੱਕੇ ਹਨ। {locked} ਰੁਪਏ ਹਾਲੇ ਐਸਕ੍ਰੋ ਵਿੱਚ ਹਨ।',
    find_loads: '{city} ਤੋਂ ਜਾਣ ਵਾਲੇ ਲੋਡ ਵਿਖਾ ਰਿਹਾ ਹਾਂ। ਸਭ ਤੋਂ ਵਧੀਆ {best} ਰੁਪਏ ਦਾ ਹੈ।',
    fastag_balance: 'ਤੁਹਾਡਾ ਫਾਸਟੈਗ ਬੈਲੰਸ {balance} ਰੁਪਏ ਹੈ।',
    savings: 'ਤੁਹਾਡੀ ਬਚਤ {savings} ਰੁਪਏ ਹੈ, ਅਤੇ ਪੈਨਸ਼ਨ ਵਿੱਚ {pension} ਰੁਪਏ ਹਨ।',
    next_stop: 'ਤੁਹਾਡੇ ਰਸਤੇ ਵਿੱਚ ਅਗਲਾ ਪੜਾਅ {stop} ਹੈ।',
    breakdown: 'ਮਕੈਨਿਕ ਤੁਹਾਡੇ ਕੋਲ ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ। ਗੱਡੀ ਕੋਲ ਹੀ ਰਹੋ।',
    legal_help: 'ਕਾਨੂੰਨੀ ਮਦਦ ਸ਼ੁਰੂ ਕਰ ਰਿਹਾ ਹਾਂ। ਵਕੀਲ ਤੁਹਾਨੂੰ ਫ਼ੋਨ ਕਰਨਗੇ। ਸੜਕ ਉੱਤੇ ਨਕਦ ਨਾ ਦਿਓ।',
    sos: 'ਤੁਹਾਡੀ ਲੋਕੇਸ਼ਨ ਨਾਲ ਐਮਰਜੈਂਸੀ ਸੂਚਨਾ ਭੇਜ ਦਿੱਤੀ ਗਈ ਹੈ।',
    documents: 'ਤੁਹਾਡੇ ਕਾਗਜ਼ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ। {expiring} ਕਾਗਜ਼ ਦਾ ਨਵੀਨੀਕਰਨ ਲੋੜੀਂਦਾ ਹੈ।',
    help: 'ਤੁਸੀਂ ਕਹਿ ਸਕਦੇ ਹੋ: ਮੇਰੀ ਕਮਾਈ, ਲੋਡ ਲੱਭੋ, ਫਾਸਟੈਗ ਬੈਲੰਸ, ਮੇਰੀ ਬਚਤ, ਗੱਡੀ ਖਰਾਬ, ਕਾਨੂੰਨੀ ਮਦਦ।',
    unknown: 'ਮਾਫ਼ ਕਰਨਾ, ਸਮਝ ਨਹੀਂ ਆਇਆ। ਮਦਦ ਕਹੋ।',
  },
  te: {
    greeting: 'చెప్పండి. సంపాదన, లోడ్, ఫాస్టాగ్, పొదుపు లేదా సహాయం అనండి.',
    earnings: 'మీకు {received} రూపాయలు అందాయి. {locked} రూపాయలు ఇంకా ఎస్క్రోలో ఉన్నాయి.',
    find_loads: '{city} నుండి బయలుదేరే లోడ్లు చూపిస్తున్నాను. ఉత్తమమైనది {best} రూపాయలు.',
    fastag_balance: 'మీ ఫాస్టాగ్ బ్యాలెన్స్ {balance} రూపాయలు.',
    savings: 'మీ పొదుపు {savings} రూపాయలు, పెన్షన్‌లో {pension} రూపాయలు ఉన్నాయి.',
    next_stop: 'మీ మార్గంలో తదుపరి ఆగుదల {stop}.',
    breakdown: 'మెకానిక్‌ను మీ దగ్గరకు పంపుతున్నాము. ట్రక్కు దగ్గరే ఉండండి.',
    legal_help: 'న్యాయ సహాయం ప్రారంభిస్తున్నాను. న్యాయవాది మీకు ఫోన్ చేస్తారు.',
    sos: 'మీ లొకేషన్‌తో అత్యవసర హెచ్చరిక పంపబడింది.',
    documents: 'మీ పత్రాలు తెరుస్తున్నాను. {expiring} పత్రం పునరుద్ధరించాలి.',
    help: 'మీరు చెప్పవచ్చు: నా సంపాదన, లోడ్లు, ఫాస్టాగ్ బ్యాలెన్స్, నా పొదుపు, బ్రేక్‌డౌన్, న్యాయ సహాయం.',
    unknown: 'క్షమించండి, అర్థం కాలేదు. సహాయం అనండి.',
  },
  ta: {
    greeting: 'சொல்லுங்கள். சம்பாத்தியம், லோடு, பாஸ்டேக், சேமிப்பு அல்லது உதவி என்று சொல்லுங்கள்.',
    earnings: 'உங்களுக்கு {received} ரூபாய் கிடைத்துள்ளது. {locked} ரூபாய் இன்னும் எஸ்க்ரோவில் உள்ளது.',
    find_loads: '{city} இலிருந்து புறப்படும் லோடுகளைக் காட்டுகிறேன். சிறந்தது {best} ரூபாய்.',
    fastag_balance: 'உங்கள் பாஸ்டேக் இருப்பு {balance} ரூபாய்.',
    savings: 'உங்கள் சேமிப்பு {savings} ரூபாய், ஓய்வூதியத்தில் {pension} ரூபாய்.',
    next_stop: 'உங்கள் வழியில் அடுத்த நிறுத்தம் {stop}.',
    breakdown: 'மெக்கானிக்கை உங்களிடம் அனுப்புகிறோம். லாரியுடன் இருங்கள்.',
    legal_help: 'சட்ட உதவியைத் தொடங்குகிறேன். வழக்கறிஞர் உங்களை அழைப்பார்.',
    sos: 'உங்கள் இருப்பிடத்துடன் அவசர எச்சரிக்கை அனுப்பப்பட்டது.',
    documents: 'உங்கள் ஆவணங்களைத் திறக்கிறேன். {expiring} ஆவணம் புதுப்பிக்க வேண்டும்.',
    help: 'நீங்கள் சொல்லலாம்: என் சம்பாத்தியம், லோடு, பாஸ்டேக் இருப்பு, என் சேமிப்பு, பழுது, சட்ட உதவி.',
    unknown: 'மன்னிக்கவும், புரியவில்லை. உதவி என்று சொல்லுங்கள்.',
  },
};

/** Fill `{placeholders}` with live values. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '—'));
}

export function greeting(locale: Locale): string {
  return PHRASES[locale].greeting;
}

export function unknownReply(locale: Locale): string {
  return PHRASES[locale].unknown;
}

/** Compose the spoken answer for an intent in the driver's language. */
export function replyFor(
  intent: VoiceIntent,
  locale: Locale,
  values: Record<string, string | number>,
): SpokenReply {
  return { text: fill(PHRASES[locale][intent], values), action: intent };
}
