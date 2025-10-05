import OpenAI from "openai";
import TelegramBot from "node-telegram-bot-api";
import moment from "moment";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function isNumeric(str) {
    return /^\d+$/.test(str);
}

if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set.');
    process.exit(1);
}
if (!TELEGRAM_USER_ID) {
    console.error('TELEGRAM_USER_ID is not set.');
    process.exit(1);
}
if (!isNumeric(TELEGRAM_USER_ID)) {
    console.error('TELEGRAM_USER_ID must be your numeric Telegram user ID (not username, not @username, not group/channel ID).');
    process.exit(1);
}
if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set.');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: "https://models.github.ai/inference" });
const MODEL = "openai/gpt-4.1";

async function getTodayPhotos() {
    const today = moment().startOf('day');
    const now = moment();
    let photos = [];
    try {
        const updates = await bot.getUpdates();
        for (const update of updates) {
            if (update.message && update.message.from.id == TELEGRAM_USER_ID && update.message.photo) {
                const date = moment.unix(update.message.date);
                if (date.isBetween(today, now)) {
                    const photoArray = update.message.photo;
                    const fileId = photoArray[photoArray.length - 1].file_id;
                    photos.push({ fileId, date });
                }
            }
        }
    } catch (e) {
        console.error('Error fetching Telegram photos:', e);
        throw e;
    }
    return photos;
}

async function getPhotoUrl(fileId) {
    try {
        const file = await bot.getFile(fileId);
        return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    } catch (e) {
        console.error('Error getting photo URL:', e);
        throw e;
    }
}

async function analyzeMealPhoto(photoUrl) {
    try {
        const prompt = `Analyze this meal photo and estimate: Calories, Protein, Healthy Fats, Carbohydrates, Fiber, Vegetables, Fruits, Hydration, Herbs & Spices. Return values for each.`;
        // Custom endpoint and model usage
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: photoUrl } }
                    ]
                }
            ],
            max_tokens: 500
        });
        return response.choices[0].message.content;
    } catch (e) {
        console.error('Error analyzing meal photo:', e);
        throw e;
    }
}

async function summarizeIntake(mealAnalyses) {
    try {
        const summaryPrompt = `Here are my meal nutrition analyses for today:\n${mealAnalyses.join('\n\n')}
Summarize my total intake for Calories, Protein, Healthy Fats, Carbohydrates, Fiber, Vegetables, Fruits, Hydration, Herbs & Spices. Identify any deficiencies and suggest what I should eat tomorrow to improve my nutrition. Keep the summary concise (max 5 lines).`;
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'user', content: summaryPrompt }
            ],
            max_tokens: 200
        });
        return response.choices[0].message.content;
    } catch (e) {
        console.error('Error summarizing intake:', e);
        throw e;
    }
}

async function sendTelegramMessage(text) {
    try {
        await bot.sendMessage(TELEGRAM_USER_ID, text);
    } catch (e) {
        console.error('Error sending Telegram message:', e);
        throw e;
    }
}

(async () => {
    try {
        console.log('Fetching today\'s meal photos from Telegram...');
        const photos = await getTodayPhotos();
        if (photos.length === 0) {
            await sendTelegramMessage('No meal photos found for today. Please send your meal photos to this bot.');
            console.log('No meal photos found for today.');
            return;
        }
        console.log(`Found ${photos.length} meal photos.`);
        let mealAnalyses = [];
        for (const [i, photo] of photos.entries()) {
            console.log(`Analyzing photo ${i + 1} of ${photos.length}...`);
            const photoUrl = await getPhotoUrl(photo.fileId);
            const analysis = await analyzeMealPhoto(photoUrl);
            mealAnalyses.push(analysis);
        }
        console.log('Summarizing daily intake...');
        const summary = await summarizeIntake(mealAnalyses);
        await sendTelegramMessage(`Your nutrition summary for today:\n${summary}`);
        console.log('Summary sent to Telegram.');
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
