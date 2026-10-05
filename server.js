require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const WebSocket = require("ws");
const { execFile } = require("child_process");


/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 8000);

const API_KEY = process.env.GEMINI_API_KEY;

const LIVE_MODEL =
    process.env.GEMINI_MODEL ||
    "gemini-3.1-flash-live-preview";


if (!API_KEY) {
    console.error("");
    console.error("ERROR: GEMINI_API_KEY is missing.");
    console.error("Add GEMINI_API_KEY to your .env file.");
    console.error("");
    process.exit(1);
}


/* =========================================================
   DIRECTORIES
========================================================= */

const ROOT_DIR = __dirname;

const PUBLIC_DIR =
    path.join(ROOT_DIR, "public");

const UPLOAD_DIR =
    path.join(ROOT_DIR, "uploads");

const CONVERTED_DIR =
    path.join(ROOT_DIR, "converted");

const TEMP_DIR =
    path.join(ROOT_DIR, "temp");


[
    PUBLIC_DIR,
    UPLOAD_DIR,
    CONVERTED_DIR,
    TEMP_DIR
].forEach((dir) => {
    fs.mkdirSync(dir, {
        recursive: true
    });
});


/* =========================================================
   GEMINI LIVE URL
========================================================= */

const GEMINI_LIVE_URL =
    "wss://generativelanguage.googleapis.com/ws/" +
    "google.ai.generativelanguage.v1beta." +
    "GenerativeService.BidiGenerateContent" +
    "?key=" +
    encodeURIComponent(API_KEY);


/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.use(
    express.json({
        limit: "20mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(PUBLIC_DIR)
);


/* =========================================================
   MULTER
========================================================= */

const storage =
    multer.diskStorage({

        destination: function (
            req,
            file,
            cb
        ) {

            cb(
                null,
                UPLOAD_DIR
            );

        },

        filename: function (
            req,
            file,
            cb
        ) {

            const ext =
                path
                    .extname(
                        file.originalname
                    )
                    .toLowerCase();

            const filename =
                "upload-" +
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .substring(2, 9) +
                ext;

            cb(
                null,
                filename
            );

        }

    });


const upload =
    multer({

        storage,

        limits: {
            fileSize:
                100 * 1024 * 1024
        }

    });


/* =========================================================
   LIBREOFFICE PATH
========================================================= */

function getLibreOfficePath() {

    if (
        process.platform === "win32"
    ) {

        const locations = [

            "C:\\Program Files\\LibreOffice\\program\\soffice.exe",

            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"

        ];

        for (
            const location of locations
        ) {

            if (
                fs.existsSync(location)
            ) {

                return location;

            }

        }

        return "soffice.exe";
    }


    if (
        process.platform === "darwin"
    ) {

        return (
            "/Applications/" +
            "LibreOffice.app/" +
            "Contents/MacOS/soffice"
        );

    }


    return "libreoffice";
}


/* =========================================================
   SAFE DELETE
========================================================= */

function safeDelete(file) {

    try {

        if (
            file &&
            fs.existsSync(file)
        ) {

            fs.unlinkSync(file);

        }

    } catch (_) {}

}


/* =========================================================
   SAFE REMOVE DIRECTORY
========================================================= */

function safeRemoveDirectory(directory) {

    try {

        fs.rmSync(
            directory,
            {
                recursive: true,
                force: true
            }
        );

    } catch (_) {}

}


/* =========================================================
   CONVERT OFFICE FILE TO PDF
========================================================= */

function convertToPDF(inputFile) {

    return new Promise(
        (resolve, reject) => {

            const soffice =
                getLibreOfficePath();

            const jobId =
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .substring(2, 9);

            const outputDir =
                path.join(
                    TEMP_DIR,
                    "lo-" + jobId
                );

            fs.mkdirSync(
                outputDir,
                {
                    recursive: true
                }
            );

            const args = [
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                outputDir,
                inputFile
            ];

            console.log(
                "LibreOffice:",
                soffice
            );

            execFile(
                soffice,
                args,
                {
                    windowsHide: true,
                    timeout: 120000,
                    maxBuffer:
                        20 * 1024 * 1024
                },
                (
                    error,
                    stdout,
                    stderr
                ) => {

                    console.log(
                        "LibreOffice stdout:",
                        stdout || ""
                    );

                    console.log(
                        "LibreOffice stderr:",
                        stderr || ""
                    );

                    setTimeout(
                        () => {

                            let files = [];

                            try {

                                files =
                                    fs.readdirSync(
                                        outputDir
                                    );

                            } catch (readError) {

                                safeRemoveDirectory(
                                    outputDir
                                );

                                reject(
                                    readError
                                );

                                return;
                            }


                            const pdfName =
                                files.find(
                                    (file) => {

                                        return (
                                            path
                                                .extname(file)
                                                .toLowerCase() ===
                                            ".pdf"
                                        );

                                    }
                                );


                            if (!pdfName) {

                                safeRemoveDirectory(
                                    outputDir
                                );

                                reject(
                                    new Error(
                                        [
                                            "LibreOffice could not convert this file.",
                                            error?.message || "",
                                            stdout || "",
                                            stderr || ""
                                        ]
                                            .filter(Boolean)
                                            .join("\n")
                                    )
                                );

                                return;
                            }


                            const generatedPDF =
                                path.join(
                                    outputDir,
                                    pdfName
                                );

                            const finalPDF =
                                path.join(
                                    CONVERTED_DIR,
                                    "presentation-" +
                                    jobId +
                                    ".pdf"
                                );


                            try {

                                fs.copyFileSync(
                                    generatedPDF,
                                    finalPDF
                                );

                            } catch (copyError) {

                                safeRemoveDirectory(
                                    outputDir
                                );

                                reject(
                                    copyError
                                );

                                return;
                            }


                            safeRemoveDirectory(
                                outputDir
                            );


                            resolve(
                                finalPDF
                            );

                        },
                        800
                    );

                }
            );

        }
    );

}


/* =========================================================
   UPLOAD PRESENTATION
========================================================= */

app.post(
    "/api/upload",
    upload.single("document"),
    async (
        req,
        res
    ) => {

        try {

            if (!req.file) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Please select a file."

                    });

            }


            const ext =
                path
                    .extname(
                        req.file.originalname
                    )
                    .toLowerCase();


            const allowed = [
                ".ppt",
                ".pptx",
                ".pdf",
                ".doc",
                ".docx"
            ];


            if (
                !allowed.includes(ext)
            ) {

                safeDelete(
                    req.file.path
                );

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Supported files: PPT, PPTX, PDF, DOC and DOCX."

                    });

            }


            let pdfPath;


            if (
                ext === ".pdf"
            ) {

                pdfPath =
                    path.join(
                        CONVERTED_DIR,
                        "presentation-" +
                        Date.now() +
                        ".pdf"
                    );

                fs.copyFileSync(
                    req.file.path,
                    pdfPath
                );

            } else {

                pdfPath =
                    await convertToPDF(
                        req.file.path
                    );

            }


            safeDelete(
                req.file.path
            );


            return res.json({

                success: true,

                pdfUrl:
                    "/documents/" +
                    encodeURIComponent(
                        path.basename(
                            pdfPath
                        )
                    )

            });

        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );

            if (req.file) {

                safeDelete(
                    req.file.path
                );

            }

            return res
                .status(500)
                .json({

                    success: false,

                    error:
                        error.message ||
                        "Could not process file."

                });

        }

    }
);


/* =========================================================
   PDF ROUTE
========================================================= */

app.get(
    "/documents/:filename",
    (
        req,
        res
    ) => {

        const filename =
            path.basename(
                req.params.filename
            );

        const file =
            path.join(
                CONVERTED_DIR,
                filename
            );


        if (
            !fs.existsSync(file)
        ) {

            return res
                .status(404)
                .send(
                    "Document not found."
                );

        }


        res.setHeader(
            "Content-Type",
            "application/pdf"
        );

        res.setHeader(
            "Cache-Control",
            "no-store"
        );

        res.sendFile(file);

    }
);


/* =========================================================
   BROWSER SEND HELPER
========================================================= */

function sendToBrowser(
    browserSocket,
    data
) {

    if (
        !browserSocket ||
        browserSocket.readyState !==
            WebSocket.OPEN
    ) {

        return;
    }


    try {

        browserSocket.send(
            JSON.stringify(data)
        );

    } catch (error) {

        console.error(
            "Browser send error:",
            error.message
        );

    }

}


/* =========================================================
   SEND CAPTIONS
========================================================= */

function sendCaptions(
    browserSocket,
    english,
    secondary,
    language
) {

    const englishText =
        String(
            english || ""
        ).trim();

    const secondaryText =
        String(
            secondary || ""
        ).trim();


    /*
       THIS FORMAT MATCHES THE
       index.html I UPDATED.
    */

    sendToBrowser(
        browserSocket,
        {

            type:
                "captions",

            english:
                englishText,

            secondary:
                secondaryText,

            language:
                language || ""

        }
    );

}


/* =========================================================
   PARSE TWO-LINE OUTPUT
========================================================= */

function parseTwoLineCaption(
    text
) {

    const value =
        String(
            text || ""
        )
        .replace(
            /\r/g,
            ""
        )
        .trim();


    if (!value) {

        return {
            english: "",
            secondary: ""
        };

    }


    /*
       Expected:

       English sentence
       Translated sentence
    */

    const lines =
        value
            .split("\n")
            .map(
                line =>
                    line.trim()
            )
            .filter(Boolean);


    let english = "";
    let secondary = "";


    /*
       Remove accidental labels.
    */

    const cleaned =
        lines.map(
            line =>
                line
                    .replace(
                        /^english\s*:\s*/i,
                        ""
                    )
                    .replace(
                        /^simple\s+english\s*:\s*/i,
                        ""
                    )
                    .replace(
                        /^translation\s*:\s*/i,
                        ""
                    )
                    .replace(
                        /^translated\s*:\s*/i,
                        ""
                    )
                    .trim()
        );


    if (
        cleaned.length >= 2
    ) {

        english =
            cleaned[0];

        secondary =
            cleaned
                .slice(1)
                .join(" ");

    } else {

        /*
           If model accidentally returns
           one line, use it as English.
        */

        english =
            cleaned[0] || "";

        secondary =
            "";

    }


    return {
        english,
        secondary
    };

}


/* =========================================================
   SYSTEM INSTRUCTION
========================================================= */

const SYSTEM_INSTRUCTION = `

You are a real-time classroom subtitle assistant.

The user is speaking to a class.

Your job is NOT to answer the teacher.

Your job is ONLY to convert the teacher's speech into
two subtitle lines.

OUTPUT EXACTLY TWO LINES FOR EVERY TEACHER UTTERANCE.

LINE 1:
Simple, clear English.

LINE 2:
The exact same meaning translated into the currently
selected second language.

Rules:

1. The teacher may speak ANY human language.
2. Always understand the original speech first.
3. Line 1 must ALWAYS be simple English.
4. Line 2 must ALWAYS be the selected second language.
5. Do not answer questions.
6. Do not add explanations.
7. Do not summarize unnecessarily.
8. Do not omit important information.
9. Preserve names.
10. Preserve numbers.
11. Preserve dates.
12. Preserve technical terms.
13. Preserve programming terms.
14. Preserve formulas and symbols where possible.
15. Keep both lines short enough for live captions.
16. Do not add "English:".
17. Do not add "Translation:".
18. Do not use bullets.
19. Do not use Markdown.

Example:

Let's start the class.
మనం క్లాస్ మొదలు పెడదాం.

Another example:

Open the project file.
ప్రాజెక్ట్ ఫైల్‌ను ఓపెన్ చేయండి.

Only output the two subtitle lines.

`;


/* =========================================================
   CREATE GEMINI LIVE CONNECTION
========================================================= */

function createGeminiConnection(
    browserSocket
) {

    console.log("");
    console.log(
        "Connecting to Gemini Live..."
    );

    const gemini =
        new WebSocket(
            GEMINI_LIVE_URL
        );


    let geminiReady =
        false;

    let selectedLanguage =
        "";

    let modelTranscript =
        "";

    let currentEnglish =
        "";

    let currentSecondary =
        "";


    /*
       Queue audio while setup is
       being completed.
    */

    const audioQueue = [];


    /* =====================================================
       SEND LANGUAGE UPDATE
    ===================================================== */

    function sendLanguageUpdate() {

        if (!geminiReady) {
            return;
        }

        if (
            gemini.readyState !==
            WebSocket.OPEN
        ) {

            return;
        }


        const language =
            selectedLanguage ||
            "English";


        /*
           Gemini Live supports realtime text
           updates through realtimeInput.
        */

        const instruction = {

            realtimeInput: {

                text:
                    `The selected second subtitle language is now "${language}".

For every new teacher utterance:
Line 1 = simple English.
Line 2 = the same meaning in ${language}.

Do not answer this instruction.
Wait for the teacher's next speech.`

            }

        };


        try {

            gemini.send(
                JSON.stringify(
                    instruction
                )
            );

        } catch (error) {

            console.error(
                "Language update error:",
                error.message
            );

        }

    }


    /* =====================================================
       GEMINI OPEN
    ===================================================== */

    gemini.on(
        "open",
        () => {

            console.log(
                "Gemini Live WebSocket connected."
            );


            /*
               IMPORTANT:

               3.1 Flash Live requires AUDIO
               as the response modality.

               We use outputAudioTranscription
               to get the generated subtitle text.
            */

            const setup = {

                setup: {

                    model:
                        "models/" +
                        LIVE_MODEL,


                    generationConfig: {

                        responseModalities: [
                            "AUDIO"
                        ],

                        thinkingConfig: {

                            thinkingLevel:
                                "minimal"

                        }

                    },


                    inputAudioTranscription: {},

                    outputAudioTranscription: {},


                    systemInstruction: {

                        parts: [

                            {
                                text:
                                    SYSTEM_INSTRUCTION
                            }

                        ]

                    }

                }

            };


            gemini.send(
                JSON.stringify(
                    setup
                )
            );


            console.log(
                "Gemini Live setup sent."
            );

        }
    );


    /* =====================================================
       GEMINI MESSAGE
    ===================================================== */

    gemini.on(
        "message",
        (
            raw
        ) => {

            let message;


            try {

                message =
                    JSON.parse(
                        raw.toString()
                    );

            } catch (error) {

                console.error(
                    "Invalid Gemini message:",
                    raw.toString()
                );

                return;

            }


            /* =================================================
               SETUP COMPLETE
            ================================================= */

            if (
                message.setupComplete
            ) {

                geminiReady =
                    true;


                console.log(
                    "Gemini Live setup complete."
                );


                sendToBrowser(
                    browserSocket,
                    {

                        type:
                            "connected",

                        text:
                            "Gemini Live connected."

                    }
                );


                /*
                   Send selected language
                   if already selected.
                */

                if (
                    selectedLanguage
                ) {

                    sendLanguageUpdate();

                }


                /*
                   Send queued audio.
                */

                while (
                    audioQueue.length > 0 &&
                    gemini.readyState ===
                        WebSocket.OPEN
                ) {

                    const audioMessage =
                        audioQueue.shift();

                    try {

                        gemini.send(
                            JSON.stringify(
                                audioMessage
                            )
                        );

                    } catch (error) {

                        console.error(
                            "Queued audio error:",
                            error.message
                        );

                    }

                }


                return;

            }


            /* =================================================
               ERROR
            ================================================= */

            if (
                message.error
            ) {

                console.error(
                    "GEMINI ERROR:"
                );

                console.error(
                    JSON.stringify(
                        message.error,
                        null,
                        2
                    )
                );


                sendToBrowser(
                    browserSocket,
                    {

                        type:
                            "error",

                        text:
                            message
                                ?.error
                                ?.message ||
                            "Gemini Live error."

                    }
                );


                return;

            }


            const serverContent =
                message.serverContent ||
                {};


            /* =================================================
               INPUT AUDIO TRANSCRIPTION
            ================================================= */

            if (
                serverContent.inputTranscription
            ) {

                const teacherText =
                    String(
                        serverContent
                            .inputTranscription
                            .text ||
                        ""
                    ).trim();


                if (
                    teacherText
                ) {

                    console.log(
                        "TEACHER:",
                        teacherText
                    );


                    /*
                       DO NOT put teacher transcript
                       into English caption.
                    */

                    sendToBrowser(
                        browserSocket,
                        {

                            type:
                                "inputTranscript",

                            text:
                                teacherText

                        }
                    );

                }

            }


            /* =================================================
               OUTPUT TRANSCRIPTION
            ================================================= */

            if (
                serverContent.outputTranscription
            ) {

                const text =
                    String(
                        serverContent
                            .outputTranscription
                            .text ||
                        ""
                    );


                if (text) {

                    console.log(
                        "MODEL TRANSCRIPT:",
                        text
                    );


                    modelTranscript +=
                        text;


                    const parsed =
                        parseTwoLineCaption(
                            modelTranscript
                        );


                    if (
                        parsed.english
                    ) {

                        currentEnglish =
                            parsed.english;

                    }


                    if (
                        parsed.secondary
                    ) {

                        currentSecondary =
                            parsed.secondary;

                    }


                    sendCaptions(
                        browserSocket,
                        currentEnglish,
                        currentSecondary,
                        selectedLanguage
                    );

                }

            }


            /* =================================================
               TURN COMPLETE
            ================================================= */

            if (
                serverContent.turnComplete
            ) {

                console.log(
                    "GEMINI TURN COMPLETE"
                );


                const final =
                    parseTwoLineCaption(
                        modelTranscript
                    );


                if (
                    final.english
                ) {

                    currentEnglish =
                        final.english;

                }


                if (
                    final.secondary
                ) {

                    currentSecondary =
                        final.secondary;

                }


                /*
                   FINAL CAPTION
                */

                sendCaptions(
                    browserSocket,
                    currentEnglish,
                    currentSecondary,
                    selectedLanguage
                );


                sendToBrowser(
                    browserSocket,
                    {

                        type:
                            "turnComplete"

                    }
                );


                /*
                   Reset for next teacher utterance.
                */

                modelTranscript =
                    "";

                currentEnglish =
                    "";

                currentSecondary =
                    "";

            }

        }
    );


    /* =====================================================
       GEMINI CLOSE
    ===================================================== */

    gemini.on(
        "close",
        (
            code,
            reason
        ) => {

            console.log(
                "Gemini Live closed:",
                code,
                reason
                    ? reason.toString()
                    : ""
            );


            sendToBrowser(
                browserSocket,
                {

                    type:
                        "error",

                    text:
                        "Gemini Live connection closed."

                }
            );

        }
    );


    /* =====================================================
       GEMINI ERROR
    ===================================================== */

    gemini.on(
        "error",
        (
            error
        ) => {

            console.error(
                "Gemini WebSocket error:",
                error.message
            );


            sendToBrowser(
                browserSocket,
                {

                    type:
                        "error",

                    text:
                        error.message

                }
            );

        }
    );


    /* =====================================================
       BROWSER MESSAGE
    ===================================================== */

    browserSocket.on(
        "message",
        (
            raw
        ) => {

            let data;


            try {

                data =
                    JSON.parse(
                        raw.toString()
                    );

            } catch (error) {

                console.error(
                    "Invalid browser message:",
                    raw.toString()
                );

                return;

            }


            /* =================================================
               LANGUAGE
            ================================================= */

            if (
                data.type ===
                "language"
            ) {

                selectedLanguage =
                    String(
                        data.language ||
                        ""
                    ).trim();


                console.log(
                    "SELECTED LANGUAGE:",
                    selectedLanguage ||
                    "NONE"
                );


                /*
                   Clear second caption immediately.
                */

                sendToBrowser(
                    browserSocket,
                    {

                        type:
                            "languageChanged",

                        language:
                            selectedLanguage

                    }
                );


                /*
                   Tell current Live session
                   about new language.
                */

                sendLanguageUpdate();


                return;

            }


            /* =================================================
               AUDIO
            ================================================= */

            if (
                data.type ===
                "audio"
            ) {

                if (
                    typeof data.data !==
                    "string"
                ) {

                    return;

                }


                if (
                    !data.data
                ) {

                    return;

                }


                const audioMessage = {

                    realtimeInput: {

                        audio: {

                            data:
                                data.data,

                            mimeType:
                                "audio/pcm;rate=16000"

                        }

                    }

                };


                if (
                    geminiReady &&
                    gemini.readyState ===
                        WebSocket.OPEN
                ) {

                    try {

                        gemini.send(
                            JSON.stringify(
                                audioMessage
                            )
                        );

                    } catch (error) {

                        console.error(
                            "Audio send error:",
                            error.message
                        );

                    }

                } else {

                    /*
                       Queue only a limited amount.
                    */

                    if (
                        audioQueue.length < 100
                    ) {

                        audioQueue.push(
                            audioMessage
                        );

                    }

                }


                return;

            }

        }
    );


    /* =====================================================
       BROWSER CLOSED
    ===================================================== */

    browserSocket.on(
        "close",
        () => {

            console.log(
                "Browser disconnected."
            );


            try {

                if (
                    gemini.readyState ===
                        WebSocket.OPEN ||
                    gemini.readyState ===
                        WebSocket.CONNECTING
                ) {

                    gemini.close();

                }

            } catch (_) {}

        }
    );

}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        app
    );


/* =========================================================
   WEBSOCKET SERVER
========================================================= */

const wss =
    new WebSocket.Server({

        server,

        path:
            "/live"

    });


wss.on(
    "connection",
    (
        browserSocket
    ) => {

        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            "BROWSER CONNECTED"
        );
        console.log(
            "AI SMART COMMUNICATION ASSISTANT"
        );
        console.log(
            "=========================================="
        );


        sendToBrowser(
            browserSocket,
            {

                type:
                    "info",

                text:
                    "Connecting to Gemini Live..."

            }
        );


        createGeminiConnection(
            browserSocket
        );

    }
);


/* =========================================================
   SERVER ERROR
========================================================= */

server.on(
    "error",
    (
        error
    ) => {

        console.error(
            "SERVER ERROR:",
            error
        );

    }
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            "AI SMART COMMUNICATION ASSISTANT"
        );
        console.log(
            "=========================================="
        );

        console.log(
            "Server:",
            `http://localhost:${PORT}`
        );

        console.log(
            "Live model:",
            LIVE_MODEL
        );

        console.log(
            "Text model:",
            "NONE"
        );

        console.log(
            "Gemini 3.7:",
            "REMOVED"
        );

        console.log(
            "API key:",
            API_KEY
                ? "PRESENT"
                : "MISSING"
        );

        console.log(
            "WebSocket:",
            `ws://localhost:${PORT}/live`
        );

        console.log(
            "LibreOffice:",
            getLibreOfficePath()
        );

        console.log(
            "=========================================="
        );

        console.log("");

    }
);