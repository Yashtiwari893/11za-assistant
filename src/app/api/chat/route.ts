import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/infrastructure/database"
import { getGroqClient } from "@/lib/ai/clients"
import { AI_MODELS } from "@/config"

const supabaseAdmin = getSupabaseClient()

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
    const completion = await getGroqClient().chat.completions.create({
      model: AI_MODELS.CHAT_FALLBACK,
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

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Chat error'
    console.error("Chat API error:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
