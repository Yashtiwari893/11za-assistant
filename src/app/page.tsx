"use client";

import { useEffect, useRef, useState } from "react";

// ── Floating chat bubble animation ──
const CHAT_MESSAGES = [
    { from: "user", text: "Kal 6pm ko doctor yaad dilana" },
    { from: "bot", text: "⏰ Done! Kal 6pm yaad dilaaunga" },
    { from: "user", text: "Grocery mein milk add karo" },
    { from: "bot", text: "✅ Milk grocery list mein add!" },
    { from: "user", text: "Mera aadhar dikhao" },
    { from: "bot", text: "📁 Yeh raha aapka Aadhar Card" },
];

function ChatBubble({ msg, delay }: { msg: typeof CHAT_MESSAGES[0]; delay: number }) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), delay);
        return () => clearTimeout(t);
    }, [delay]);

    const isBot = msg.from === "bot";
    return (
        <div
            className={`flex ${isBot ? "justify-start" : "justify-end"} transition-all duration-500`}
            style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)" }}
        >
            <div
                className={`px-4 py-2 rounded-2xl text-sm max-w-[80%] ${isBot
                        ? "bg-white text-gray-800 rounded-tl-sm shadow-sm"
                        : "text-white rounded-tr-sm"
                    }`}
                style={isBot ? {} : { background: "linear-gradient(135deg, #25D366, #128C7E)" }}
            >
                {msg.text}
            </div>
        </div>
    );
}

const FEATURES = [
    {
        icon: "⏰",
        title: "Smart Reminders",
        desc: "Hinglish mein bolo — 'kal 5 bje yaad dilana' — aur ZARA exactly waqt pe remind karega.",
    },
    {
        icon: "📋",
        title: "Lists & Tasks",
        desc: "Grocery, office, shopping — sab lists ek jagah. 'Milk done' bolo aur list update.",
    },
    {
        icon: "📁",
        title: "Document Vault",
        desc: "Aadhar, passport, bills — photo bhejo, save ho jata hai. 'Mera aadhar dikhao' — milega!",
    },
    {
        icon: "🌅",
        title: "Morning Briefing",
        desc: "Roz 9 AM pe: aaj ke reminders, pending tasks — sab ek message mein.",
    },
    {
        icon: "🎙️",
        title: "Voice Notes",
        desc: "Type karna nahi — voice note bhejo. ZARA samjhega aur kaam karega.",
    },
    {
        icon: "💬",
        title: "AI Chat",
        desc: "Recipe, weather, GK — kuch bhi puch. 24/7 available dost.",
    },
];

export default function HomePage() {
    const [tick, setTick] = useState(0);

    // Re-animate chat every 8 seconds
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 8000);
        return () => clearInterval(interval);
    }, []);

    return (
        <main
            className="min-h-screen text-white overflow-x-hidden"
            style={{ background: "#0a0f0a", fontFamily: "'DM Sans', sans-serif" }}
        >
            {/* Google Font */}
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        .syne { font-family: 'Syne', sans-serif; }
        .glow-green { box-shadow: 0 0 40px rgba(37,211,102,0.15); }
        .feature-card:hover { transform: translateY(-4px); border-color: rgba(37,211,102,0.4); }
        .feature-card { transition: all 0.3s ease; }
        .pulse-dot { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:0.5; transform:scale(1.3); } }
        .float { animation: float 6s ease-in-out infinite; }
        @keyframes float { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-10px); } }
        .fade-up { animation: fadeUp 0.7s ease forwards; }
        @keyframes fadeUp { from{ opacity:0; transform:translateY(24px); } to{ opacity:1; transform:translateY(0); } }
      `}</style>

            {/* ── NAV ── */}
            <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{ background: "#25D366" }}>Z</div>
                    <span className="syne text-lg font-bold tracking-tight">ZARA</span>
                    <span className="text-xs text-gray-500 ml-1">by 11za</span>
                </div>
                <a
                    href="https://wa.me/919726654060"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium px-5 py-2 rounded-full transition-all hover:opacity-90"
                    style={{ background: "#25D366", color: "#fff" }}
                >
                    Try Free →
                </a>
            </nav>

            {/* ── HERO ── */}
            <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                {/* Left */}
                <div className="fade-up">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8"
                        style={{ background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.3)", color: "#25D366" }}>
                        <span className="pulse-dot w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#25D366" }} />
                        No app download needed
                    </div>

                    <h1 className="syne text-5xl lg:text-6xl font-extrabold leading-tight mb-6" style={{ letterSpacing: "-0.02em" }}>
                        Aapka Personal
                        <br />
                        <span style={{ color: "#25D366" }}>Assistant</span>
                        <br />
                        WhatsApp pe
                    </h1>

                    <p className="text-gray-400 text-lg leading-relaxed mb-10 max-w-md">
                        Reminders, lists, documents, AI chat — sab kuch WhatsApp mein. Hindi, English, Gujarati — kisi bhi bhasha mein.
                    </p>

                    <div className="flex flex-wrap gap-4">
                        <a
                            href="https://wa.me/919726654060?text=Hi"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-7 py-3.5 rounded-full text-base font-semibold transition-all hover:opacity-90 glow-green"
                            style={{ background: "#25D366", color: "#fff" }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            WhatsApp pe Try Karo
                        </a>
                        <a
                            href="#features"
                            className="px-7 py-3.5 rounded-full text-base font-medium transition-all hover:bg-white/5"
                            style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#ccc" }}
                        >
                            Features dekhein
                        </a>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-8 mt-12 pt-8" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        {[["1000+", "Businesses"], ["1M+", "Messages/month"], ["3", "Languages"]].map(([num, label]) => (
                            <div key={label}>
                                <div className="syne text-2xl font-bold" style={{ color: "#25D366" }}>{num}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right — WhatsApp mockup */}
                <div className="flex justify-center lg:justify-end float">
                    <div
                        className="w-72 rounded-3xl overflow-hidden shadow-2xl glow-green"
                        style={{ background: "#111b11", border: "1px solid rgba(37,211,102,0.2)" }}
                    >
                        {/* WA Header */}
                        <div className="px-4 py-3 flex items-center gap-3" style={{ background: "#1a2b1a" }}>
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
                                style={{ background: "#25D366" }}>Z</div>
                            <div>
                                <div className="text-white text-sm font-semibold">ZARA</div>
                                <div className="text-xs flex items-center gap-1" style={{ color: "#25D366" }}>
                                    <span className="pulse-dot w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#25D366" }} />
                                    Online
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="p-4 space-y-3 min-h-64" style={{ background: "#0d1a0d" }} key={tick}>
                            {CHAT_MESSAGES.map((msg, i) => (
                                <ChatBubble key={`${tick}-${i}`} msg={msg} delay={i * 900} />
                            ))}
                        </div>

                        {/* Input bar */}
                        <div className="px-3 py-3 flex items-center gap-2" style={{ background: "#1a2b1a" }}>
                            <div className="flex-1 rounded-full px-4 py-2 text-xs text-gray-500" style={{ background: "#0d1a0d" }}>
                                Message...
                            </div>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ background: "#25D366" }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                                    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── FEATURES ── */}
            <section id="features" className="max-w-6xl mx-auto px-6 pb-24">
                <div className="text-center mb-14">
                    <div className="text-sm font-medium mb-3" style={{ color: "#25D366" }}>Features</div>
                    <h2 className="syne text-3xl lg:text-4xl font-extrabold">Sab kuch WhatsApp mein</h2>
                    <p className="text-gray-500 mt-3 text-base">Koi app download nahi. Koi signup nahi. Bas "Hi" bhejo.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {FEATURES.map((f) => (
                        <div
                            key={f.title}
                            className="feature-card rounded-2xl p-6"
                            style={{ background: "#111811", border: "1px solid rgba(255,255,255,0.07)" }}
                        >
                            <div className="text-3xl mb-4">{f.icon}</div>
                            <h3 className="syne text-base font-bold mb-2">{f.title}</h3>
                            <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── HOW IT WORKS ── */}
            <section className="max-w-3xl mx-auto px-6 pb-24 text-center">
                <div className="text-sm font-medium mb-3" style={{ color: "#25D366" }}>How it works</div>
                <h2 className="syne text-3xl lg:text-4xl font-extrabold mb-12">3 steps mein shuru karo</h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                    {[
                        { n: "1", title: "WhatsApp pe Hi bhejo", desc: "Koi form, koi app nahi" },
                        { n: "2", title: "Apni baat kaho", desc: "Hindi, English, Gujarati — koi bhi bhasha" },
                        { n: "3", title: "ZARA kaam karega", desc: "Reminders, lists, documents — sab" },
                    ].map((step) => (
                        <div key={step.n} className="flex flex-col items-center gap-4">
                            <div
                                className="w-12 h-12 rounded-full flex items-center justify-center syne text-xl font-extrabold"
                                style={{ background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.3)", color: "#25D366" }}
                            >
                                {step.n}
                            </div>
                            <div>
                                <div className="font-semibold mb-1">{step.title}</div>
                                <div className="text-gray-500 text-sm">{step.desc}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── CTA ── */}
            <section className="max-w-6xl mx-auto px-6 pb-24">
                <div
                    className="rounded-3xl p-10 lg:p-16 text-center glow-green"
                    style={{ background: "linear-gradient(135deg, #0d1f0d, #142014)", border: "1px solid rgba(37,211,102,0.2)" }}
                >
                    <div className="text-4xl mb-4">👋</div>
                    <h2 className="syne text-3xl lg:text-4xl font-extrabold mb-4">
                        Abhi shuru karo — free hai
                    </h2>
                    <p className="text-gray-400 mb-8 max-w-md mx-auto">
                        Koi credit card nahi. Koi app nahi. Sirf WhatsApp pe "Hi" bhejo aur ZARA baaki sambhal lega।
                    </p>
                    <a
                        href="https://wa.me/919726654060?text=Hi"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-base font-semibold transition-all hover:opacity-90"
                        style={{ background: "#25D366", color: "#fff" }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        WhatsApp pe "Hi" bhejo
                    </a>
                </div>
            </section>

            {/* ── FOOTER ── */}
            <footer className="border-t max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4"
                style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
                        style={{ background: "#25D366" }}>Z</div>
                    <span className="text-sm text-gray-500">ZARA by 11za · Engees Communications Pvt Ltd</span>
                </div>
                <div className="flex gap-6 text-xs text-gray-600">
                    <a href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</a>
                    <a href="/terms" className="hover:text-gray-400 transition-colors">Terms</a>
                    <a href="https://11za.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">11za.com</a>
                </div>
            </footer>
        </main>
    );
}