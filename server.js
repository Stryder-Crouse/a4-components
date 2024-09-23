import express from 'express'
import ViteExpress from 'vite-express'
import dotenv from 'dotenv'
import mongodb from 'mongodb'
import passport from 'passport'
import expressSession from 'express-session'
import passportGithub2 from 'passport-github2'
dotenv.config()
const app = express()
const DbConnectionURL = `mongodb+srv://${process.env.DbUser}:${process.env.DbPass}@${process.env.DbURL}`
const client = new mongodb.MongoClient( DbConnectionURL )

app.use(express.urlencoded({ extended: false })); //url parser
app.use(express.json()) // parse data as json
const port = 3000
const Dbname="FantasyFootballPublic"

passport.use(new passportGithub2.Strategy({
        clientID: process.env.gitHubClient,
        clientSecret: process.env.gitHubSecret,
        callbackURL: "http://localhost:3000/auth/github/callback"
    },
    async function (accessToken, refreshToken, profile, done) {
        await client.connect()
        let usersTable = await client.db(Dbname).collection("Users")

        //attempt to find the user, if no user is present create one
        let findResult = await usersTable.findOneAndUpdate({id:profile.id},
            { $setOnInsert:{id:profile.id,userName:profile.username}}, {upsert:true})

        return done(null, findResult)
    }
));

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(async function (userId, done) {
    await client.connect()
    let usersTable = await client.db(Dbname).collection("Users")
    let findUser = await usersTable.findOne({id:userId})
    done(null, findUser);
});

app.use(expressSession({ secret:process.env.sessionSecret, resave: false, saveUninitialized: false }))
app.use(passport.initialize())
app.use(passport.session({}));

//send user for auth by github
app.get('/auth/github', passport.authenticate('github'),function (req,res){
    console.log("should not run")
})

app.get('/userName',isAuthenticated,function (req,res){
    res.status(200)
    res.send({userName:req.user.userName})
})

//call back url
app.get('/auth/github/callback', passport.authenticate('github',{failureRedirect: '/'}),function (req,res){
    res.redirect("/table");
})

app.post('/logout', function(req, res, next) {
    req.logout(function(err) {
        console.log(err)
        res.redirect('/');
    });

});

function isAuthenticated(req, res, next) {
    //console.log(req)
    if (req.isAuthenticated()) { return next(); }
    else{
        res.sendStatus(400)
    }
}

//send back fantasy football data from database (will need to change this to be by user)
app.get('/FFtable',isAuthenticated, async (req, res) => {
    try{
        await client.connect()
        let playersTable = await client.db(Dbname).collection("Players")
        let players = await playersTable.find({ownerID:req.user.userName+req.user.id}).toArray()
        console.log("fired")
        res.status(200)
        res.send(players)
    }catch (e){
        console.log(e)
    }
    // res.status(200)
    // res.send(appdata)
})

//get a record
app.post('/record',isAuthenticated, async (req, res) => {
    try {
        let dbId = req.body['dbId']
        console.log("DBID")
        console.log(dbId)
        await client.connect()
        let playersTable = await client.db(Dbname).collection("Players")
        let foundPlayer = await playersTable.findOne({_id: new mongodb.ObjectId(dbId),ownerID:req.user.userName+req.user.id })
        if(foundPlayer){
            res.status(200)
            res.send(foundPlayer)
        }
        else{
            res.status(400)
            res.send('not found in db')
        }
    } catch (e) {
        res.status(404)
        res.send('error connecting to db')
    }

})

//post new player
app.post('/submit',isAuthenticated, async (req, res) => {
    let newRecord = req.body
    //check if record is valid if so add it
    if (recordIsVaild(newRecord)) {
        //calculate rDelta for newRecord
        newRecord["rDelta"] = newRecord["rPPR"]-newRecord["rDyn"]
        //add who owns the player
        newRecord["ownerID"] = req.user.userName+req.user.id
        //add to database
        await client.connect()
        let playersTable = await client.db(Dbname).collection("Players")
        let newID = (await playersTable.insertOne(newRecord)).insertedId
        res.status(200)
        res.send(newID.toString())
    }
    else{
        res.status(200)
        res.send("invaild new player")
    }
})

//delete a player (add database connection)
app.post('/delete',isAuthenticated, async (req, res) => {
    try {
        let dbId = req.body['dbId']
        await client.connect()
        let playersTable = await client.db(Dbname).collection("Players")

        let deleteResult = await playersTable.deleteOne({_id: new mongodb.ObjectId(dbId),ownerID:req.user.userName+req.user.id})
        if (deleteResult) {
            res.status(200)
            res.send("delete done")
        } else {
            res.status(400)
            res.send('delete faild: not found in db')
        }
    } catch (e) {
        res.status(404)
        res.send('error connecting to db')
    }
})

//edit a player
app.post('/edit',isAuthenticated, async (req, res) => {
    try {
        let dbId = req.body['dbId']
        let editedRecord = req.body['editedRecord']
        await client.connect()
        let playersTable = await client.db(Dbname).collection("Players")
        let updateScheme = {
            $set: {
                rDyn:parseInt(editedRecord["rDyn"]),
                rPPR:parseInt(editedRecord["rPPR"]),
                rDelta:parseInt(editedRecord["rDelta"]),
                name:editedRecord["name"],
                team:editedRecord["team"],
                pos:editedRecord["pos"],
                byeWeek:parseInt(editedRecord["byeWeek"]),
                age:parseInt(editedRecord["age"])
            },
        }
        let updateResult = await playersTable.updateOne({_id: new mongodb.ObjectId(dbId),ownerID:req.user.userName+req.user.id},updateScheme)
        if (updateResult) {
            res.status(200)
            res.send("Update done")
        } else {
            res.status(400)
            res.send('not found in db')
        }
    } catch (e) {
        res.status(404)
        res.send('error connecting to db')
    }
})

function recordIsVaild(newRecord){
    if(newRecord['rDyn']==null ){
        return false
    }
    if(newRecord['rPPR']==null ){
        return false
    }
    if(newRecord['name']==null || newRecord['name']===""){
        return false
    }
    if(newRecord['team']==null || newRecord['team']===""){
        return false
    }
    if(newRecord['pos']==null || newRecord['pos']===""){
        return false
    }
    if(newRecord['byeWeek']==null ){
        return false
    }
    if(newRecord['age']==null ){
        return false
    }
    return true

}

ViteExpress.listen( app, 3000, () => console.log("Server is listening...") )
