/* This is an example service for connecting to the database */
const db = require('./database');
const helper = require('../utils/helper');

function dateSet(dates){
	let dateSet = new Set();

	for(let i = 0; i < dates.length; i++){
		dateSet.add(new Date(dates[i].Expiry).toDateString());
	}
	return dateSet;
}

//Some of the dates have different time values.  They don't serve this purpose, so set to 00:00:00
function handleDateHours(expContents){
	let expirationDate = expContents[0];
	let startDate = undefined;
	let retDate = undefined;
	if(expirationDate.length > 0){
		startDate = new Date(expirationDate[0].Expiry);
		startDate.setUTCHours(0,0,0,0);
		retDate = new Date(expirationDate[expirationDate.length - 1].Expiry);
		retDate.setUTCHours(0,0,0,0);
	}
	return {startDate, retDate, expirationDate};
}

/* Example Service, Name these functions accoring to what you are returning. */
async function getObjects(ticker, start, end) {
	try {

		//Get the expiration dates
		let expContents = await db.query('CALL GetExpDates(?,?,?);', [
			ticker,
			start,
			end
		]);

		//Some of the dates include times, set all the times to 00:00:00
		let retDates = handleDateHours(expContents);
		let startDate = retDates.startDate;
		let retDate = retDates.retDate;
		let expirationDate = retDates.expirationDate;
		let startPeriodDate = new Date(start);
		let endDate = new Date(end);

		// We need the previous expDate if our start date is not an expiration date
		if (startDate == undefined || (new Date(startPeriodDate) < new Date(startDate))){
			let prevExp = await db.query('CALL GetPreviousExpDate(?);', [
				start
			]);
			let d = prevExp[0][0].expiry;
			expirationDate.unshift({"Expiry": d});
		}
		
		// We need the next expDate if our end date is not an expiration date
		if (retDate == undefined || retDate <= endDate){
			let expDate = await db.query('CALL GetNextExpDate(?,?);', [
				ticker,
				end
			]);
			let d = expDate[0][0].NearestExpiry;
			expirationDate.push({"Expiry": d});
		}
		let exDates = dateSet(expirationDate);

		//Get the strike and opIds
		let strikeContents = [];
		for(let i = 1; i < expirationDate.length; i++){
			//The start needs to be the expiration date
			let s = expirationDate[i-1].Expiry;
			let expire = expirationDate[i].Expiry;
			let sContents = await db.query('CALL GetClosestStrike(?, ?, ?);', [
				ticker,
				s,
				expire, 
			]);
			strikeContents.push(sContents[0][0]);
		}

		//Get the bids and asks
		let datesBidAskContentsNested = [];
		let splitContentsNested = [];
		let expire = undefined;
		let optId = undefined;
		let begin = start;

		for(let i = 0; i < strikeContents.length; i++){

			optId = strikeContents[i].optid;

			//The end date in GetDatesBidAsk should be the next expiration date, unless it's the final iteration of the loop.
			//The final iteration of the loop will end at the "end date" given by the user, not the expiration date.
			if(i + 1 < strikeContents.length){
				expire = expirationDate[i+1].Expiry;
			}
			else{
				//Bug Fix: Add a space to the end of the date because JS is stupid and will subtract the date by one when using new Date(expire) if you don't have it.
				//Spent 3 hours of my day tracking down this nonsense.
				//Only need it here because the date format in "end" comes from the date selection bar in the ui.  Different than the dates in "expirationDate"
				expire = end + " ";
			}

			
			let dbaContents = await db.query('CALL GetDatesBidAsk(?, ?, ?);', [
				optId,
				begin,
				expire,
			]);

			if(i + 0 < strikeContents.length){
				let expire2 = new Date(expire);
				let splitExpire = undefined;

				if(i + 1 < strikeContents.length && exDates.has(expire2.toDateString())){
					splitExpire = expire2.setDate(expire2.getDate() - 1);
					splitExpire = new Date(splitExpire);
				}
				else{
					splitExpire = expire;
				}

				//Get the split factor contents
				let splitContents = await db.query('CALL GetSplit(?, ?, ?);', [
					optId,
					begin,
					splitExpire,
				]);
				splitContentsNested.push(splitContents[0]);
			}

			begin = expire;

			if(i < strikeContents.length - 1 && exDates.has(new Date(dbaContents[0][dbaContents[0].length-1].date_).toDateString())){
				dbaContents[0].pop();
			}
			datesBidAskContentsNested.push(dbaContents[0]);
		}	

		//Merge the nested arrays into a single one
		let datesBidAskContents = [].concat.apply([], datesBidAskContentsNested);
		let splitFactorContents = [].concat.apply([], splitContentsNested);

		//Call the get data stored procedure
		let dataContents = await db.query('CALL GetData(?, ?, ?);', [
			ticker,
			start,
			end,
		]);

		//Remove the nested array
		dataContents = dataContents[0];

		//Call the GetIDAndIssuer stored procedure
		let idAndIssuerContents = await db.query('CALL GetIDAndIssuer(?);', [
			ticker
		]);

		let lContents = await db.query('CALL GetLiborDuringTimeframe(?,?);', [
			start,
			end
		]);

		let indexes = await Promise.all(helper.dataReception(splitFactorContents, strikeContents, datesBidAskContents, dataContents, idAndIssuerContents, expContents, lContents[0], exDates));

		return indexes;
	//	return {strikeContents, datesBidAskContents, dataContents, idAndIssuerContents, expContents, liborContents};

	} catch (err) {
		console.log(err);
		return `Error searching for ${ticker}`;
	}
}

/* Export the functions here*/
module.exports = {
	getObjects,
};
