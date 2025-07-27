import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, RevealData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullRoomData } from '../utils/PullRoomData';
import { PullPlayerData } from '../utils/PullPlayerData';

export async function RevealAnswer(
    socket: Socket, 
    revealData: RevealData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["playerKey", "playerSecret", "roomCode"];

    const sanitizedData = await SanitizeData(revealData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed while revealing answer. " + sanitizedData.error;
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.playerKey || !sanitizedData.playerSecret || !sanitizedData.roomCode) {
        returnData.error = "Missing playerKey, playerSecret, or roomCode after sanitization.";
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }

    const roomCode = sanitizedData.roomCode;


    // Mark the answer as revealed
    if (!await pool.query(`UPDATE room SET question_revealed = true WHERE room_code='${roomCode}';`)) {
        returnData.error = "Couldn't set question as revealed.";
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }


    // Pull room data to see who's right
    const roomData = await PullRoomData(roomCode, pool);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to reveal answer."; }
        if(roomData === null)  { returnData.error = "Tried to reveal answer in a non-existant room."; }
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }
    returnData.roomData = roomData;
    const correctAnswer = roomData.roomCorrectAnswer;
    const currentPlayerIndex = roomData.roomCurrentPlayer;


    // Pull the player list to update
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) {
        returnData.error = "Couldn't pull player list while revealing answer.";
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });

    // Count the number of players who guessed correctly
    const numberOfPlayersCorrect = playerList.reduce((accumulator, currentValue) => { return accumulator + ((currentValue.playerChoice==correctAnswer) ? 1 : 0); }, 0 );


    // forEach and await aren't good friends
    for (const player of playerList) {
        const playerKey = player.playerKey;

        // if actor, get a point for everyone correct
        if (player.playerIndex == currentPlayerIndex) {
            const updatedScore = (parseInt(player.playerScore.toString()) + numberOfPlayersCorrect);
            if (!await pool.query(`UPDATE player SET score = ${updatedScore} WHERE player_key = ${playerKey};`)) {
                returnData.error = "Couldn't update actor score while revealing answer.";
                socket.emit('answer revealed', JSON.stringify(returnData));
                return;
            }
            player.playerScore = updatedScore;
        }

        // if not actor and correct, get one point
        else if (player.playerChoice == correctAnswer) {
            const updatedScore = (parseInt(player.playerScore.toString()) + 1);
            if (!await pool.query(`UPDATE player SET score = ${updatedScore} WHERE player_key = ${playerKey};`)) {
                returnData.error = "Couldn't update player score while revealing answer.";
                socket.emit('answer revealed', JSON.stringify(returnData));
                return;
            }
            player.playerScore = updatedScore;
        }
    }
    returnData.playerList = playerList;


    // Tell everyone the answer was revealed
    returnData.success = true;
    io.in(roomCode).emit('answer revealed',  JSON.stringify(returnData));
}