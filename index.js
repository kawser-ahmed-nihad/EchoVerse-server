const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require('mongodb');
const admin = require("firebase-admin");

// middleware
app.use(cors());
app.use(express.json());




const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const service = JSON.parse(decoded);

const serviceAccount = require("./echoverse.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



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
        const reportsCollection = client.db("echoverse").collection('reports');
        const announcementsCollection = client.db("echoverse").collection('announcements');


        // custom middleware 

        const verifyFbToken = async (req, res, next) => {
            const authHeaders = req.headers.authorization;

            if (!authHeaders || !authHeaders.startsWith('Bearer ')) {
                return res.status(401).send({ message: "Unauthorized access" });
            }

            const token = authHeaders.split(' ')[1];

            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                req.decoded = decodedToken;
                next();
            } catch (error) {
                // console.error("Token verification failed", error);
                return res.status(403).send({ message: "Forbidden access" });
            }
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== "admin") {
                return res.status(403).send({ message: "Forbidden access" });
            }
            next();
        }

        // Check if user is admin
        app.get('/api/users/admin/:email', verifyFbToken, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.status(403).send({ message: "Forbidden access" });
            }

            try {
                const user = await usersCollection.findOne({ email: email });

                const isAdmin = user?.role === 'admin';

                res.send({ admin: isAdmin });
            } catch (error) {
                console.error("Error checking admin status:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


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

        //  Get single user by email
        app.get('/api/users/:email', verifyFbToken, async (req, res) => {
            const email = req.params.email;

            try {
                const user = await client
                    .db("echoverse")
                    .collection("users")
                    .findOne({ email });

                if (!user) {

                    return res.send({
                        email,
                        status: "bronze", // default membership
                        role: "user", // default role
                        totalPosts: 0, // default value
                    });
                }

                res.send(user);
            } catch (error) {
                console.error("Error fetching user:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // user get 
        app.get('/api/users', verifyFbToken, async (req, res) => {
            const { search } = req.query;
            const email = req.decoded.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ message: "Forbidden access" });
            }

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
        app.patch('/api/users/admin/:id', verifyFbToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;

            const email = req.params.email;

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
        app.post('/api/payments', verifyFbToken, async (req, res) => {
            const email = req.params.email;



            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            res.send(result);
        });

        // payments create
        app.post('/api/create-payment-intent', verifyFbToken, async (req, res) => {
            const { amount } = req.body;
            const email = req.params.email;



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
        app.patch('/api/posts/:id/vote', verifyFbToken, async (req, res) => {
            const { id } = req.params;
            const { userId, voteType } = req.body;




            if (!['upVote', 'downVote', null].includes(voteType)) {
                return res.status(400).send({ message: "Invalid vote type!" });
            }

            try {
                const post = await postsCollection.findOne({ _id: new ObjectId(id) });
                if (!post) return res.status(404).send({ message: "Post not found!" });

                if (!Array.isArray(post.votes)) {
                    post.votes = [];
                }

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

                await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { votes: post.votes, upVote: upVoteCount, downVote: downVoteCount } }
                );

                res.send({
                    message: "Vote updated successfully.",
                    upVote: upVoteCount,
                    downVote: downVoteCount,
                    voteType: voteType,
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to update the vote!" });
            }
        });


        // Add a new post
        app.post('/api/posts', verifyFbToken, async (req, res) => {
            try {
                const postData = req.body;
                const email = req.decoded.email;

             
                const user = await usersCollection.findOne({ email });
                const userPostsCount = await postsCollection.countDocuments({ authorEmail: email });

               
                if (user?.role === "bronze" && userPostsCount >= 5) {
                    return res.status(403).send({ message: "Post limit reached for Bronze users" });
                }

                postData.createdAt = new Date().toISOString();
                const result = await postsCollection.insertOne(postData);
                res.send({ insertedId: result.insertedId });
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to create post" });
            }
        });

        // post id
        app.get('/api/posts/:id', verifyFbToken, async (req, res) => {
            const { id } = req.params;
            const email = req.params.email;

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
        app.get('/api/comments', verifyFbToken, async (req, res) => {
            const { postId } = req.query;
            const email = req.params.email;

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
        app.post('/api/comments', verifyFbToken, async (req, res) => {
            const commentData = req.body;
            const email = req.params.email;

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
        app.post('/api/tags', verifyFbToken, verifyAdmin, async (req, res) => {
            const { tagName } = req.body;
            const email = req.params.email;

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

        // GET: Get posts by logged-in user only
        // app.get('/api/logged/posts', verifyFbToken, async (req, res) => {
        //     try {
        //         const userEmail = req.decoded?.email;
        //         const limit = parseInt(req.query.limit);
        //         if (!userEmail) {
        //             return res.status(403).send({ message: "Unauthorized access" });
        //         }

        //         const posts = await postsCollection
        //             .find({ authorEmail: userEmail })
        //             .sort({ createdAt: -1 })
        //             .limit(limit)
        //             .toArray();

        //         res.send({ posts });
        //     } catch (err) {
        //         console.error('Error fetching user posts:', err);
        //         res.status(500).send({ error: "Failed to fetch posts" });
        //     }
        // });

        app.get('/api/logged/posts', verifyFbToken, async (req, res) => {
            try {
                const userEmail = req.decoded?.email;
                const limit = parseInt(req.query.limit) || 5;
                if (!userEmail) {
                    return res.status(403).send({ message: "Unauthorized access" });
                }

                const pipeline = [
                    { $match: { authorEmail: userEmail } },
                    {
                        $lookup: {
                            from: "comments",
                            let: { postId: "$_id" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $eq: ["$postId", { $toString: "$$postId" }] }
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
                    { $sort: { createdAt: -1 } },
                    { $limit: limit }
                ];

                const posts = await postsCollection.aggregate(pipeline).toArray();

                res.send({ posts });
            } catch (err) {
                console.error("Error fetching user posts:", err);
                res.status(500).send({ error: "Failed to fetch posts" });
            }
        });

        //  Get all posts by a specific user email
        app.get('/api/posts/user/:email', verifyFbToken, async (req, res) => {
            try {
                const email = req.params.email;


                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: "Forbidden access" });
                }

                const posts = await client
                    .db("echoverse")
                    .collection("posts")
                    .find({ authorEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(posts);
            } catch (error) {
                console.error("Error fetching user's posts:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // DELETE post by ID
        app.delete('/api/posts/:id', verifyFbToken, async (req, res) => {
            const postId = req.params.id;
            const email = req.params.email;

            try {
                const result = await postsCollection.deleteOne({ _id: new ObjectId(postId) });

                if (result.deletedCount === 1) {
                    res.status(200).json({ message: 'Post deleted successfully' });
                } else {
                    res.status(404).json({ message: 'Post not found' });
                }
            } catch (error) {
                console.error('Delete error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // GET /api/comments/:postId
        app.get('/api/comments/:postId', verifyFbToken, async (req, res) => {
            const { postId } = req.params;
            const email = req.params.email;


            try {
                const comments = await commentsCollection
                    .find({ postId })
                    .project({ userEmail: 1, comment: 1 })
                    .toArray();

                res.json({ comments });

            } catch (error) {
                console.error("Failed to fetch comments", error);
                res.status(500).json({ error: 'Failed to fetch comments' });
            }
        });




        // POST /api/reports
        app.post('/api/reports', verifyFbToken, verifyAdmin, async (req, res) => {

            const {
                postId,
                commentId,
                feedback,
                commentText,
                commenterEmail,
                email,
                reportedAt
            } = req.body;


            if (!postId || !commentId || !feedback || !commentText || !commenterEmail || !reportedAt) {
                return res.status(400).json({ error: 'Missing fields in report' });
            }

            try {
                const report = {
                    postId,
                    commentId,
                    feedback,
                    commentText,
                    commenterEmail,
                    email,
                    reportedAt,
                };

                await reportsCollection.insertOne(report);

                res.status(201).json({ message: 'Report submitted successfully' });
            } catch (error) {
                console.error("Failed to submit report", error);
                res.status(500).json({ error: 'Failed to submit report' });
            }
        });
        // get Report
        app.get('/api/reports', verifyFbToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;

            const reports = await reportsCollection.find().sort({ reportedAt: -1 }).toArray();
            res.json(reports);
        });

        // update Report
        app.patch('/api/reports/:id', verifyFbToken, verifyAdmin, async (req, res) => {

            const { id } = req.params;
            const { status } = req.body;

            const email = req.params.email;


            const result = await reportsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            res.json(result);
        });
        // delete comments
        app.delete('/api/comments/:commentId', verifyFbToken, verifyAdmin, async (req, res) => {
            const { commentId } = req.params;

            const email = req.params.email;


            const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
            res.json(result);
        });

        // POST /api/announcements
        app.post('/api/announcements', verifyFbToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;

            try {
                const { authorImg, authorName, title, description } = req.body;

                // Basic validation
                if (!authorName || !title || !description) {
                    return res.status(400).json({ message: "Please fill all required fields" });
                }

                const newAnnouncement = {
                    authorImg,
                    authorName,
                    title,
                    description,
                    createdAt: new Date(),
                };

                const result = await announcementsCollection.insertOne(newAnnouncement);
                res.status(201).json({ message: "Announcement created", announcementId: result.insertedId });
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Failed to create announcement" });
            }
        });

        // admin
        app.get('/profile', verifyFbToken, verifyAdmin, async (req, res) => {


            try {
                const admin = await usersCollection.findOne({ email: req.decoded.email });
                if (!admin) return res.status(404).json({ message: 'Admin not found' });

                res.json({
                    name: admin.name,
                    email: admin.email,
                    image: admin.image,
                    role: admin.role
                });
            } catch (error) {
                res.status(500).json({ message: 'Server error' });
            }
        });



        // GET /api/admin/stats
        app.get('/stats', verifyFbToken, verifyAdmin, async (req, res) => {

            try {
                const totalUsers = await usersCollection.countDocuments();
                const announcementCount = await announcementsCollection.countDocuments();
                const reportCount = await reportsCollection.countDocuments();
                const actionsTaken = await reportsCollection.countDocuments({ status: 'resolved' });

                res.json({
                    totalUsers,
                    announcementCount,
                    reportCount,
                    actionsTaken,
                });
            } catch (error) {
                res.status(500).json({ message: 'Server error' });
            }
        });

        // get announcements
        app.get('/api/announcements', async (req, res) => {
            const email = req.params.email;


            const announcements = await announcementsCollection.find().toArray();
            res.send(announcements);
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
    console.log(` Server running on port ${port}`);
});
