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
        const usersCollection = client.db("echoverse").collection('users');

        // Create new user
        app.post('/api/users', async (req, res) => {
            const { name, email, photo } = req.body; // ✅ photo destructure করো

            try {
                const existingUser = await usersCollection.findOne({ email });

                if (existingUser) {
                    // Update last login time
                    const result = await usersCollection.updateOne(
                        { email },
                        {
                            $set: {
                                lastLogin: new Date()
                            }
                        }
                    );
                    return res.send({ message: 'User login time updated', updatedCount: result.modifiedCount });
                } else {
                    const newUser = {
                        name,
                        email,
                        photo: photo || '',
                        role: 'user',
                        status: 'bronze',
                        lastLogin: new Date(),
                        createdAt: new Date()
                    };

                    const result = await usersCollection.insertOne(newUser);
                    return res.send({ message: 'New user created', insertedId: result.insertedId });
                }
            } catch (error) {
                console.error("User save error:", error);
                return res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // user get 
        app.get('/api/users', async (req, res) => {
            const { search } = req.query;

            let query = {};
            if (search) {
                query.name = { $regex: search, $options: 'i' };
            }

            try {
                const users = await usersCollection.find(query).toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send({ message: 'Error fetching users' });
            }
        });

        // Update user status
        app.patch('/api/users/admin/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: 'admin' } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update role' });
            }
        });


        // POST: Add tag
        app.post('/api/tags', async (req, res) => {
            const { tagName } = req.body;

            const existingTag = await tagsCollection.findOne({ tagName: tagName });

            if (existingTag) {
                return res.status(400).send({ message: "Tag already exists!" });
            }

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
