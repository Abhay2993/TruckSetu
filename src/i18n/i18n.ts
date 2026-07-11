/**
 * Feature F — Vernacular localization scaffolding.
 *
 * Architectural choice: a hand-rolled, fully typed dictionary instead of
 * i18next. At this stage the app needs (a) compile-time safety that every
 * locale defines every key, and (b) zero runtime dependencies. The
 * `TranslationKeys` interface enforces (a): adding a key without translating
 * it into all five locales is a type error. Swapping this for i18next later
 * only requires re-implementing `useTranslation`.
 *
 * The active locale lives in the persisted app store (see useAppStore), so a
 * driver who picks ਪੰਜਾਬੀ keeps it across app restarts.
 */

import { useAppStore } from '../stores/useAppStore';
import type { Locale } from '../types';

export interface TranslationKeys {
  appTagline: string;
  chooseRole: string;
  roleDriver: string;
  roleDealer: string;
  roleDriverDesc: string;
  roleDealerDesc: string;
  /** Target phrases from the spec: */
  bookLoad: string;
  advanceReceived: string;
  uploadPod: string;
  findDhaba: string;
  /** Escrow & FASTag surface strings: */
  lockedInEscrow: string;
  releaseBalance: string;
  fastagBalance: string;
  topUpViaUpi: string;
  youAreOffline: string;
}

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'ta', label: 'தமிழ்' },
];

const translations: Record<Locale, TranslationKeys> = {
  en: {
    appTagline: "India's trusted bridge between loads and trucks",
    chooseRole: 'How will you use TruckSetu?',
    roleDriver: 'Truck Driver',
    roleDealer: 'Dealer / Broker',
    roleDriverDesc: 'Trips, navigation, dhabas & payouts',
    roleDealerDesc: 'Post loads, track shipments & payments',
    bookLoad: 'Book Load',
    advanceReceived: 'Advance Received',
    uploadPod: 'Upload POD',
    findDhaba: 'Find Dhaba',
    lockedInEscrow: 'Locked in Escrow',
    releaseBalance: 'Release Balance',
    fastagBalance: 'FASTag Balance',
    topUpViaUpi: 'Top Up via UPI',
    youAreOffline: 'You are offline — GPS points are being cached on device',
  },
  hi: {
    appTagline: 'लोड और ट्रक के बीच भरोसे का सेतु',
    chooseRole: 'आप TruckSetu कैसे इस्तेमाल करेंगे?',
    roleDriver: 'ट्रक ड्राइवर',
    roleDealer: 'डीलर / ब्रोकर',
    roleDriverDesc: 'ट्रिप, नेविगेशन, ढाबा और भुगतान',
    roleDealerDesc: 'लोड पोस्ट करें, शिपमेंट और पेमेंट ट्रैक करें',
    bookLoad: 'लोड बुक करें',
    advanceReceived: 'एडवांस प्राप्त हुआ',
    uploadPod: 'पीओडी अपलोड करें',
    findDhaba: 'ढाबा खोजें',
    lockedInEscrow: 'एस्क्रो में सुरक्षित',
    releaseBalance: 'बकाया जारी करें',
    fastagBalance: 'फास्टैग बैलेंस',
    topUpViaUpi: 'UPI से टॉप-अप करें',
    youAreOffline: 'आप ऑफ़लाइन हैं — GPS डेटा डिवाइस पर सेव हो रहा है',
  },
  pa: {
    appTagline: 'ਲੋਡ ਅਤੇ ਟਰੱਕ ਵਿਚਕਾਰ ਭਰੋਸੇ ਦਾ ਪੁਲ',
    chooseRole: 'ਤੁਸੀਂ TruckSetu ਕਿਵੇਂ ਵਰਤੋਗੇ?',
    roleDriver: 'ਟਰੱਕ ਡਰਾਈਵਰ',
    roleDealer: 'ਡੀਲਰ / ਬ੍ਰੋਕਰ',
    roleDriverDesc: 'ਟ੍ਰਿਪ, ਨੈਵੀਗੇਸ਼ਨ, ਢਾਬੇ ਅਤੇ ਭੁਗਤਾਨ',
    roleDealerDesc: 'ਲੋਡ ਪੋਸਟ ਕਰੋ, ਸ਼ਿਪਮੈਂਟ ਤੇ ਪੇਮੈਂਟ ਟ੍ਰੈਕ ਕਰੋ',
    bookLoad: 'ਲੋਡ ਬੁੱਕ ਕਰੋ',
    advanceReceived: 'ਐਡਵਾਂਸ ਮਿਲ ਗਿਆ',
    uploadPod: 'ਪੀਓਡੀ ਅੱਪਲੋਡ ਕਰੋ',
    findDhaba: 'ਢਾਬਾ ਲੱਭੋ',
    lockedInEscrow: 'ਐਸਕ੍ਰੋ ਵਿੱਚ ਸੁਰੱਖਿਅਤ',
    releaseBalance: 'ਬਕਾਇਆ ਜਾਰੀ ਕਰੋ',
    fastagBalance: 'ਫਾਸਟੈਗ ਬੈਲੰਸ',
    topUpViaUpi: 'UPI ਨਾਲ ਟਾਪ-ਅੱਪ ਕਰੋ',
    youAreOffline: 'ਤੁਸੀਂ ਔਫਲਾਈਨ ਹੋ — GPS ਡਾਟਾ ਡਿਵਾਈਸ ਤੇ ਸੇਵ ਹੋ ਰਿਹਾ ਹੈ',
  },
  te: {
    appTagline: 'లోడ్లు మరియు ట్రక్కుల మధ్య నమ్మకమైన వంతెన',
    chooseRole: 'మీరు TruckSetu ను ఎలా వాడతారు?',
    roleDriver: 'ట్రక్ డ్రైవర్',
    roleDealer: 'డీలర్ / బ్రోకర్',
    roleDriverDesc: 'ట్రిప్పులు, నావిగేషన్, ధాబాలు & చెల్లింపులు',
    roleDealerDesc: 'లోడ్ పోస్ట్ చేయండి, షిప్‌మెంట్లు ట్రాక్ చేయండి',
    bookLoad: 'లోడ్ బుక్ చేయండి',
    advanceReceived: 'అడ్వాన్స్ అందింది',
    uploadPod: 'POD అప్‌లోడ్ చేయండి',
    findDhaba: 'ధాబా వెతకండి',
    lockedInEscrow: 'ఎస్క్రోలో భద్రం',
    releaseBalance: 'బ్యాలెన్స్ విడుదల చేయండి',
    fastagBalance: 'FASTag బ్యాలెన్స్',
    topUpViaUpi: 'UPI తో టాప్-అప్',
    youAreOffline: 'మీరు ఆఫ్‌లైన్‌లో ఉన్నారు — GPS డేటా పరికరంలో సేవ్ అవుతోంది',
  },
  ta: {
    appTagline: 'லோடுகளுக்கும் லாரிகளுக்கும் இடையிலான நம்பிக்கை பாலம்',
    chooseRole: 'TruckSetu-வை எப்படி பயன்படுத்துவீர்கள்?',
    roleDriver: 'லாரி ஓட்டுநர்',
    roleDealer: 'டீலர் / புரோக்கர்',
    roleDriverDesc: 'பயணங்கள், வழிசெலுத்தல், தாபாக்கள் & பணம்',
    roleDealerDesc: 'லோட் பதிவிடவும், சரக்கு & பணம் கண்காணிக்கவும்',
    bookLoad: 'லோட் புக் செய்யவும்',
    advanceReceived: 'முன்பணம் பெறப்பட்டது',
    uploadPod: 'POD பதிவேற்றவும்',
    findDhaba: 'தாபா தேடவும்',
    lockedInEscrow: 'எஸ்க்ரோவில் பாதுகாப்பு',
    releaseBalance: 'மீதத் தொகையை விடுவிக்கவும்',
    fastagBalance: 'FASTag இருப்பு',
    topUpViaUpi: 'UPI மூலம் டாப்-அப்',
    youAreOffline: 'நீங்கள் ஆஃப்லைனில் — GPS தரவு சாதனத்தில் சேமிக்கப்படுகிறது',
  },
};

/** Pure lookup — usable outside React (e.g. in store actions / alerts). */
export function translate(locale: Locale, key: keyof TranslationKeys): string {
  return translations[locale]?.[key] ?? translations.en[key];
}

/**
 * Hook API used by screens: `const t = useTranslation();` then `t('bookLoad')`.
 * Subscribes to the locale slice only, so a language switch re-renders
 * consumers without any provider wrapping.
 */
export function useTranslation(): (key: keyof TranslationKeys) => string {
  const locale = useAppStore((s) => s.locale);
  return (key) => translate(locale, key);
}
