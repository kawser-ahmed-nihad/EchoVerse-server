const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require('mongodb');

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
        const postsCollection = client.db("echoverse").collection('posts');
        const commentsCollection = client.db("echoverse").collection('comments');


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
        // upvote / downVote update
        app.patch('/api/posts/:id/vote', async (req, res) => {
            const { id } = req.params;
            const { userId, voteType } = req.body;

            if (!['upVote', 'downVote', null].includes(voteType)) {
                return res.status(400).send({ message: "Invalid vote type!" });
            }

            try {
                const post = await postsCollection.findOne({ _id: new ObjectId(id) });
                if (!post) return res.status(404).send({ message: "Post not found!" });

                const existingVoteIndex = post.votes.findIndex(v => v.userId === userId);

                if (existingVoteIndex !== -1) {

                    const existingVoteType = post.votes[existingVoteIndex].voteType;

                    if (voteType === null) {

                        post.votes.splice(existingVoteIndex, 1);
                    } else if (existingVoteType !== voteType) {

                        post.votes[existingVoteIndex].voteType = voteType;
                    } else {

                        return res.status(400).send({ message: "Already voted this way!" });
                    }
                } else {

                    if (voteType !== null) {
                        post.votes.push({ userId, voteType });
                    }
                }

                let upVoteCount = 0;
                let downVoteCount = 0;
                post.votes.forEach(v => {
                    if (v.voteType === 'upVote') upVoteCount++;
                    else if (v.voteType === 'downVote') downVoteCount++;
                });


                const updateResult = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { votes: post.votes, upVote: upVoteCount, downVote: downVoteCount } }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(500).send({ message: "Failed to update vote counts." });
                }

                res.send({ message: "Vote updated successfully.", upVote: upVoteCount, downVote: downVoteCount });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to update the vote!" });
            }
        });


        // Add a new post
        app.post('/api/posts', async (req, res) => {
            try {
                const postData = req.body;
                postData.createdAt = new Date().toISOString();
                const result = await postsCollection.insertOne(postData);
                res.send({ insertedId: result.insertedId });
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to create post" });
            }
        });
        // post id
        app.get('/api/posts/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const post = await postsCollection.findOne({ _id: new ObjectId(id) });

                if (!post) {
                    return res.status(404).send({ message: "Post not found" });
                }

                res.send(post);
            } catch (error) {
                console.error("Error fetching single post:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // Add a comment get
        app.get('/api/comments', async (req, res) => {
            const { postId } = req.query;

            try {
                const comments = await commentsCollection
                    .find({ postId: postId })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(comments);
            } catch (error) {
                console.error("Error fetching comments:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // Add a comment
        app.post('/api/comments', async (req, res) => {
            const commentData = req.body;
            commentData.createdAt = new Date().toISOString();

            try {
                const result = await commentsCollection.insertOne(commentData);
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error("Error saving comment:", error);
                res.status(500).send({ message: "Failed to add comment" });
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

        // Get posts with pagination
        app.get('/api/posts', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;
            const selectedTag = req.query.tag;
            const searchTerm = req.query.search;
            const popular = req.query.sort === 'popular';
            const skip = (page - 1) * limit;

            let matchQuery = {};

            if (searchTerm) {
                const regex = new RegExp(searchTerm, 'i');
                matchQuery.$or = [
                    { tag: { $regex: regex } }
                ];
            } else if (selectedTag) {
                matchQuery.tag = selectedTag;
            }

            try {
                const pipeline = [];

                if (Object.keys(matchQuery).length) {
                    pipeline.push({ $match: matchQuery });
                }

                pipeline.push(
                    {
                        $addFields: {
                            voteDifference: { $subtract: ["$upVote", "$downVote"] }
                        }
                    },
                    {
                        $lookup: {
                            from: "comments",
                            let: { postId: "$_id" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $eq: ["$postId", { $toString: "$$postId" }]
                                        }
                                    }
                                }
                            ],
                            as: "commentsData"
                        }
                    },
                    {
                        $addFields: {
                            commentCount: { $size: "$commentsData" }
                        }
                    },
                    {
                        $project: {
                            commentsData: 0
                        }
                    },
                    { $sort: popular ? { voteDifference: -1 } : { createdAt: -1 } },
                    { $skip: skip },
                    { $limit: limit }
                );

                const posts = await postsCollection.aggregate(pipeline).toArray();

                const totalPosts = await postsCollection.countDocuments(matchQuery);

                res.send({
                    totalPosts,
                    currentPage: page,
                    totalPages: Math.ceil(totalPosts / limit),
                    posts,
                });
            } catch (error) {
                console.error("Error fetching posts:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
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
