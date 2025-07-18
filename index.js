const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
console.log(process.env.STRIPE_SECRET_KEY)
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
        const paymentsCollection = client.db("echoverse").collection('payments');

        // Create new user
        app.post('/api/users', async (req, res) => {
            const { name, email, photo } = req.body;

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
        // update status
        app.patch('/api/users/status/:email', async (req, res) => {
            const email = req.params.email;
            const { status } = req.body;

            const result = await usersCollection.updateOne(
                { email },
                {
                    $set: { status }
                }
            );

            if (result.modifiedCount > 0) {
                res.send({ success: true, message: "Status updated" });
            } else {
                res.send({ success: false, message: "No changes made" });
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

        // payments save
        app.post('/api/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            res.send(result);
        });

        // payments create
        app.post('/api/create-payment-intent', async (req, res) => {
            const { amount } = req.body;

            if (!amount || typeof amount !== 'number') {
                return res.status(400).json({ error: 'Invalid amount' });
            }

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount, 
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (err) {
                console.error('Stripe error:', err.message);
                res.status(500).json({ error: 'Payment Intent creation failed' });
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
