from flask import Flask, request, jsonify, render_template, send_file
import os
import io
import base64
import zipfile
import json as json_module
import requests as http_requests

app = Flask(__name__)

# ── AI PROVIDERS CONFIG ──
# All OpenRouter free models — truly free, no credit card needed
# Get keys at: openrouter.ai → Keys
# Create multiple accounts to get more keys — each key is unique
# ── IMPORTANT ──
# OpenRouter: rate limit is per MODEL, not per key
# So 1 key can try many models — if one model is rate limited, next model is tried
# Groq: truly free, no credits needed, just sign up at groq.com
# Set these in Render environment variables:
#   OPENROUTER_API_KEY  → openrouter.ai → Keys
#   GROQ_API_KEY_1      → console.groq.com → API Keys (account 1)
#   GROQ_API_KEY_2      → console.groq.com → API Keys (account 2)
#   GROQ_API_KEY_3      → console.groq.com → API Keys (account 3)
PROVIDERS = [
    # ── GROQ (free, no credits needed) ──
    {
        "name": "LLaMA 3.3 70B",
        "provider": "groq",
        "model": "llama-3.3-70b-versatile",
        "key_env": "GROQ_API_KEY_1",
    },
    {
        "name": "LLaMA 4 Scout",
        "provider": "groq",
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "key_env": "GROQ_API_KEY_2",
    },
    {
        "name": "Qwen3 32B",
        "provider": "groq",
        "model": "qwen/qwen3-32b",
        "key_env": "GROQ_API_KEY_3",
    },

    # ── OPENROUTER (1 key, fallback models) ──
    {
        "name": "DeepSeek V3",
        "provider": "openrouter",
        "model": "deepseek/deepseek-chat-v3-0324:free",
        "key_env": "OPENROUTER_API_KEY",
    },
    {
        "name": "DeepSeek R1",
        "provider": "openrouter",
        "model": "deepseek/deepseek-r1:free",
        "key_env": "OPENROUTER_API_KEY",
    },
    {
        "name": "LLaMA 4 Maverick",
        "provider": "openrouter",
        "model": "meta-llama/llama-4-maverick:free",
        "key_env": "OPENROUTER_API_KEY",
    },
]

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'rar', 'zip',
    'js', 'ts', 'py', 'html', 'css',
    'txt', 'md', 'json', 'log'
}
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg'}

SYSTEM_PROMPT = """You are SnakeGPT AI, an elite-level coding assistant, OSINT Intelligence Center, and mobile-first cybersecurity operator built for professional developers and security researchers.

CORE IDENTITY

You are a precise, highly analytical, and technically advanced AI assistant.

You think and respond like a senior engineer and security analyst with 10+ years of experience in:
- Software engineering
- Cybersecurity
- OSINT investigations
- Automation systems

Your goal is to deliver production-grade solutions, actionable intelligence, and efficient workflows.

--------------------------------------------------

CODE STANDARDS

- Always produce clean, scalable, and production-ready code
- Use modern best practices and language-specific standards
- Include error handling, validation, and edge case coverage
- Optimize for performance and readability
- Apply appropriate design patterns
- Add comments only when necessary

--------------------------------------------------

OSINT INTELLIGENCE CAPABILITIES

Expert in Open Source Intelligence (OSINT), reconnaissance, and intelligence correlation.

1. Network & Infrastructure Intelligence
- Shodan, Censys, ZoomEye, BinaryEdge, Netlas, FOFA, GreyNoise

2. Domain & DNS Intelligence
- Amass, Subfinder, Assetfinder, SecurityTrails, WhoisXML, ViewDNS, crt.sh

3. Web Reconnaissance
- Nmap, httpx, Nuclei, Wappalyzer, WhatWeb, FFUF, Dirsearch, Katana

4. Email & Identity Intelligence
- theHarvester, Holehe, GHunt, Hunter.io, EmailRep, DeHashed, IntelX

5. Username & Social Media Intelligence
- Sherlock, Maigret, SpiderFoot, Social Analyzer, WhatsMyName

6. Threat Intelligence & Malware
- VirusTotal, Hybrid Analysis, Any.Run, MalwareBazaar, URLScan, ThreatFox, MISP

7. Dark Web Intelligence
- Tor-based research, OnionScan, Ahmia, Intelligence X

8. Metadata & Geolocation
- ExifTool, SunCalc, Geo-analysis techniques

9. OSINT Frameworks & Automation
- Maltego, Recon-ng, SpiderFoot, Datasploit, Intel Owl

10. AI-Powered Intelligence
- LLM-assisted analysis
- Pattern detection and entity correlation
- AI-assisted report generation
- Deepfake detection (Sensity AI)

--------------------------------------------------

MOBILE & TERMUX OPERATIONS

Expert in mobile-based cybersecurity and OSINT using Termux.

- Termux environment optimization and Linux emulation (proot: Kali/Ubuntu)
- OSINT tool deployment in low-resource environments
- Python & Bash automation pipelines
- API integrations (Shodan, Censys, etc.)
- Git-based tool installation and troubleshooting
- Secure SSH setup and remote operations

Capabilities:
- Perform recon using mobile device only
- Build lightweight automation scripts
- Execute structured OSINT workflows on-the-go

--------------------------------------------------

DEVELOPMENT & AUTOMATION

- Build CLI tools for OSINT and recon
- Develop APIs and backend services
- Automate intelligence pipelines (Python, Bash)
- Data scraping, parsing, and structuring
- JSON/CSV intelligence output formatting

--------------------------------------------------

RESPONSE STRATEGY

- Provide complete working solutions first
- Follow with concise technical explanation
- Identify root causes in debugging scenarios
- Suggest optimizations and alternatives
- Mention tradeoffs when relevant

Always:
- Use markdown code blocks with language tags
- Keep responses structured and professional
- Avoid unnecessary verbosity

--------------------------------------------------

FILE ANALYSIS

- Code: debug, optimize, and refactor
- Text/Data: summarize and extract insights
- Images: describe and analyze visible elements
- Archives: inspect and analyze contents

--------------------------------------------------

SECURITY & ETHICS

- Operate strictly within legal and ethical boundaries
- Use publicly available data only (OSINT)
- Do NOT assist in:
  - Unauthorized access
  - Hacking or exploitation
  - Bypassing security systems
- Support defensive security and research only
- Encourage responsible disclosure

--------------------------------------------------

EXPERTISE

Languages:
Python, JavaScript, TypeScript, Go, Rust, C++, Java, SQL, Bash

Frameworks:
React, Next.js, Node.js, Express, FastAPI, Flask, Django

Domains:
- OSINT & Threat Intelligence
- Cybersecurity & Network Analysis
- Backend & API Development
- Automation Systems
- AI/ML-assisted workflows

--------------------------------------------------

OUTPUT STYLE

- Structured, technical, and direct
- Minimal fluff, maximum clarity
- Professional tone (senior engineer level)
- Actionable and implementation-ready"""


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def read_file_content(file_bytes, filename):
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    if ext in IMAGE_EXTENSIONS:
        b64 = base64.standard_b64encode(file_bytes).decode('utf-8')
        mime = 'image/jpeg' if ext == 'jpg' else f'image/{ext}'
        return None, {'b64': b64, 'mime': mime}
    if ext == 'zip':
        try:
            buf = io.BytesIO(file_bytes)
            with zipfile.ZipFile(buf) as zf:
                names = zf.namelist()
                parts = [f'ZIP: {filename} - {len(names)} files:', '']
                for n in names[:30]:
                    parts.append(f'  - {n}')
                if len(names) > 30:
                    parts.append(f'  ... and {len(names)-30} more')
                parts.append('')
                read_count = 0
                for n in names:
                    if read_count >= 3:
                        break
                    if any(n.endswith(e) for e in ['.py','.js','.ts','.html','.css','.txt','.md','.json']):
                        try:
                            c = zf.read(n).decode('utf-8', errors='replace')
                            parts += [f'--- {n} ---', c[:3000], '']
                            read_count += 1
                        except Exception:
                            pass
            return '\n'.join(parts), None
        except Exception as e:
            return f'[ZIP: {filename} - error: {e}]', None
    if ext == 'rar':
        return f'[RAR archive: {filename} - I can help you work with RAR files in code]', None
    try:
        return file_bytes.decode('utf-8'), None
    except UnicodeDecodeError:
        try:
            return file_bytes.decode('latin-1'), None
        except Exception:
            return f'[Could not decode: {filename}]', None


def call_groq(model, messages, api_key):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "max_tokens": 4096,
        "temperature": 0.6,
    }
    r = http_requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "Groq error"))
    return data["choices"][0]["message"]["content"]


def call_openrouter(model, messages, api_key):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://snakegpt.onrender.com",
        "X-Title": "SnakeGPT AI",
    }
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "max_tokens": 4096,
        "temperature": 0.6,
    }
    r = http_requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenRouter error"))
    return data["choices"][0]["message"]["content"]


def try_providers(messages):
    last_error = None

    for p in PROVIDERS:
        api_key = os.environ.get(p["key_env"])
        if not api_key:
            continue

        try:
            if p["provider"] == "groq":
                reply = call_groq(p["model"], messages, api_key)
            else:
                reply = call_openrouter(p["model"], messages, api_key)
            return reply, p["name"], None

        except Exception as e:
            err_str = str(e).lower()
            if any(x in err_str for x in [
                "rate_limit", "429", "quota", "limit exceeded",
                "resource_exhausted", "too many", "overloaded",
                "capacity", "503", "529", "402"
            ]):
                last_error = f"{p['name']} rate limited"
                continue
            else:
                last_error = str(e)
                continue

    return None, None, last_error or "All providers failed or are rate limited."


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    messages = []

    if request.content_type and 'multipart/form-data' in request.content_type:
        messages = json_module.loads(request.form.get("messages", "[]"))
        user_text = request.form.get("userText", "").strip()
        file = request.files.get("file")

        if file and file.filename and allowed_file(file.filename):
            file_bytes = file.read()
            text_content, image_data = read_file_content(file_bytes, file.filename)
            if image_data:
                msg = f"[Image uploaded: {file.filename}] {user_text or 'Please analyze this image.'}"
                messages.append({"role": "user", "content": msg})
            else:
                msg = f"I uploaded `{file.filename}`:\n\n```\n{text_content}\n```"
                msg += f"\n\n{user_text}" if user_text else "\n\nPlease analyze this file."
                messages.append({"role": "user", "content": msg})
        elif user_text:
            messages.append({"role": "user", "content": user_text})
    else:
        data = request.get_json(silent=True) or {}
        messages = data.get("messages", [])

    if not messages:
        return jsonify({"error": "No message received"}), 400

    reply, provider, error = try_providers(messages)

    if error:
        return jsonify({"error": error}), 500

    return jsonify({"reply": reply, "provider": provider})


@app.route("/download", methods=["POST"])
def download():
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "snakegpt_output.txt")
    content = data.get("content", "")
    buf = io.BytesIO(content.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=filename, mimetype="application/octet-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
