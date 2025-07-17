const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gyokyfk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        const tagsCollection = client.db("echoverse").collection('tags');

        // POST: Add tag
        app.post('/api/tags', async (req, res) => {
            const { tagName } = req.body;

            // 1️⃣ ডুপ্লিকেট ট্যাগ আছে কি না চেক করো
            const existingTag = await tagsCollection.findOne({ tagName: tagName });

            if (existingTag) {
                return res.status(400).send({ message: "❌ Tag already exists!" });
            }

            // 2️⃣ না থাকলে ইনসার্ট করো
            const result = await tagsCollection.insertOne({ tagName });
            res.send({ insertedId: result.insertedId });
        });

        // Get all tags
        app.get('/api/tags', async (req, res) => {
            const tags = await tagsCollection.find().toArray();
            res.send(tags);
        });

        await client.db("admin").command({ ping: 1 });
        console.log(" Successfully connected to MongoDB!");
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
}

run();

app.get("/", (req, res) => {
    res.send(" Server is running");
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
