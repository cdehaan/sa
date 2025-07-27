import { Pool } from 'mysql2/promise';
import { AllowedInput } from '../types';
import { VerifyPlayer } from './VerifyPlayer';

interface SanitizedData {
    clean: boolean;
    error?: string;
    playerName?: string;
    playerKey?: number;
    playerSecret?: string;
    roomCode?: string;
    questionIndex?: number | null;
}

// Check the types and content of data.
// If player key and secret are included, verify it's a real player
export async function SanitizeData(
    dirtyData: any, 
    requiredFields: string[], 
    pool: Pool
): Promise<SanitizedData> {
    const cleanData: SanitizedData = {clean: false};

    const allowedInputs: AllowedInput[] = [
        {name: "playerName",    type: "string"},
        {name: "playerKey",     type: "number"},
        {name: "playerSecret",  type: "string"},
        {name: "roomCode",      type: "string"},
        {name: "questionIndex", type: "number"}
    ]

    for (const index in allowedInputs) {
        const inputName = allowedInputs[index].name;
        const inputType = allowedInputs[index].type;
        const data = dirtyData[inputName]

        // Null and undefined are fine, e.g.:
        // Register a guess => playerName is undefined
        // Undoing a guess => questionIndex is null
        if(data === undefined) { continue; }

        if(data === null) {
            (cleanData as any)[inputName] = null;
            continue;
        }

        // Return an error if there is data, but it's the wrong type
        if(typeof data !== inputType) {
            cleanData.error = `Malformed input ${inputName}, was type ${typeof data}`;
            return cleanData;
        }

        // Strip non alpha-numeric characters from strings, and max length of 20
        if(inputType === "string") {
            (cleanData as any)[inputName] = data.replace(/[^0-9a-z_ ]/gi, '').substr(0, 20);
        }

        // All keys are ints, for parse to int
        else if(inputType === "number") {
            (cleanData as any)[inputName] = parseInt(data);
        }
    }

    // If a field is required, but not found, return an error
    for (const field in requiredFields) {
        const fieldName = requiredFields[field];
        if((cleanData as any)[fieldName] === undefined || (cleanData as any)[fieldName] === null) {
            cleanData.error = `Missing ${fieldName} data."`
            return cleanData;
        }
    }

    // If data contains a player key and player secret, validate it
    if(cleanData.playerKey && cleanData.playerSecret) {
        const verification = await VerifyPlayer({playerKey: cleanData.playerKey, playerSecret: cleanData.playerSecret, roomCode: cleanData.roomCode}, pool);
        if(verification.verified === false) {
            cleanData.error = "SanitizeData found player data that didn't validate. " + verification.error;
            return cleanData;
        }    
    }

    cleanData.clean = true;
    return cleanData;
}