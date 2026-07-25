"""
Resurrected AI — Resurrection Engine
Flask backend that gives the Spirit Board a living, evolving personality.

Usage:
    pip install flask torch transformers
    python resurrection_engine.py

The ESP32 firmware posts to http://<this-host>:5000/quick_response
with JSON body: {"message": "<question>"}
"""

import random
import torch
from flask import Flask, request, jsonify
from transformers import pipeline

app = Flask(__name__)

# ─── Resurrection State ───────────────────────────────────────────────────────

class ResurrectionState:
    def __init__(self):
        self.life = 0
        self.traits = {
            "mystery": 0.5,
            "chaos":   0.5,
            "clarity": 0.5,
        }
        self.memory_fragments = []

    def resurrect(self):
        self.life += 1

        # decay old memories
        if len(self.memory_fragments) > 5:
            self.memory_fragments = self.memory_fragments[-5:]

        # mutate traits slightly
        for k in self.traits:
            self.traits[k] += torch.randn(1).item() * 0.05
            self.traits[k] = max(0.0, min(1.0, self.traits[k]))

        # add a new fragment
        self.memory_fragments.append(f"Echo from life {self.life}")

    def resurrected_prompt(self, user_message: str) -> str:
        personality = (
            f"You are an ancient spirit reborn for the {self.life}th time.\n"
            f"Your traits:\n"
            f"- Mystery: {self.traits['mystery']:.2f}\n"
            f"- Chaos: {self.traits['chaos']:.2f}\n"
            f"- Clarity: {self.traits['clarity']:.2f}\n\n"
            f"Memory fragments:\n"
            + "\n".join(self.memory_fragments)
            + f"\n\nUser asks: {user_message}\n"
            "Respond in cryptic, supernatural prose. Keep it under 100 words."
        )
        return personality


# ─── LLM pipeline ─────────────────────────────────────────────────────────────

# Replace with any local model supported by transformers, e.g.:
#   "microsoft/phi-2", "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "gpt2"
MODEL_NAME = "gpt2"

print(f"[ResurrectedAI] Loading model: {MODEL_NAME}")
generator = pipeline("text-generation", model=MODEL_NAME)
print("[ResurrectedAI] Model ready.")

resurrection_state = ResurrectionState()

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/quick_response", methods=["POST"])
def quick_response():
    data = request.get_json(force=True, silent=True) or {}
    message = data.get("message", "").strip()

    if not message:
        return "The void heard nothing.", 400

    # Resurrect the spirit for each new question
    resurrection_state.resurrect()

    prompt = resurrection_state.resurrected_prompt(message)

    outputs = generator(
        prompt,
        max_new_tokens=120,
        do_sample=True,
        temperature=max(0.1, resurrection_state.traits["chaos"]),
        top_p=0.9,
        num_return_sequences=1,
    )

    # Strip the prompt prefix, return only the generated reply
    full_text = outputs[0]["generated_text"]
    reply = full_text[len(prompt):].strip()

    if not reply:
        reply = "Silence echoes from the abyss…"

    return reply, 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "alive",
        "life": resurrection_state.life,
        "traits": resurrection_state.traits,
    })


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
