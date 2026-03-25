import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import Groq from "groq-sdk"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { session_id, message, file_id } = await req.json()

    if (!message || !file_id) {
      return NextResponse.json({ error: "Message and file_id are required" }, { status: 400 })
    }

    // 1. Fetch relevant chunks from RAG storage
    const { data: chunks, error } = await supabaseAdmin
      .from("rag_chunks")
      .select("content")
      .eq("file_id", file_id)
      .limit(10) // Basic search for now

    if (error) throw error

    const context = (chunks || []).map(c => c.content).join("\n\n")

    // 2. Build model prompt
    // Note: We use the context from the PDF file provided
    const userPrompt = `Context from PDF file:\n${context}\n\nUser Question: ${message}`

    // 3. Stream from Groq (llama-3.3-70b-versatile)
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a helpful assistant. Use ONLY the provided context to answer questions. If info is missing, say you don't know." },
        { role: "user", content: userPrompt }
      ],
      stream: true
    })

    // 4. Return the stream
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content || ""
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      }
    })

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    })

  } catch (err: any) {
    console.error("Chat API error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
