/* Timetable for public transport in Munich */

/*
 * Magic Mirror
 * Module: MVG Munich
 *
 * By Simon Crnko
 * MIT Licensed
 *
 */

const MS_PER_MINUTE = 60000;
Module.register("mvgmunich", {
	// Default module configuration
	defaults: {
		maxEntries: 8, // maximum number of results shown on UI
		updateInterval: MS_PER_MINUTE, // update every 60 seconds
		haltestelle: "Hauptbahnhof", // default departure station
		haltestelleId: 0,
		haltestelleName: "",
		ignoreStations: [], // list of destination to be ignored in the list
		lineFiltering: {
			"active": true, 			// set this to active if filtering should be used
			"filterType": "whitelist", 	// whitelist = only specified lines will be displayed, blacklist = all lines except specified lines will be displayed
			"lineNumbers": ["U1, U3, X50"] // lines that should be on the white-/blacklist
		},
		timeToWalk: 0, 		// walking time to the station
		showWalkingTime: false, // if the walking time should be included and the starting time is displayed
		showTrainDepartureTime: true,
		showDelay: false,
		addDelay: true,
		trainDepartureTimeFormat: "relative",
		walkingTimeFormat: "relative",
		showIcons: true,
		showLineColors: true,
		iconOpacity: 1,
		fade: true,
		fadePoint: 0.25,
		transportTypesToShow: {
			"ubahn": true,
			"sbahn": true,
			"regional_bus": true,
			"bus": true,
			"tram": true
		},
		showInterruptions: false,
		showInterruptionsDetails: false,
		countInterruptionsAsItemShown: false,
	},

	getStyles: function () {
		return ["mvgmunich.css"];
	},

	// Load translations files
	getTranslations: function () {
		return {
			en: "translations/en.json",
			de: "translations/de.json"
		};
	},

	start: function () {
		this.resultData = [];
		this.interruptionData = null;
		Log.info("Starting module: " + this.name + ", identifier: " + this.identifier);
		if (this.config.haltestelle !== "") {
			this.sendSocketNotification("GET_STATION_INFO", this.config);
		}
	},

	/*
	 * getData
	 * function call getData function in node_helper.js
	 *
	 */
	getData: function () {
		const self = this;
		self.sendSocketNotification("GET_DEPARTURE_DATA", self.config);
		setInterval(function () {
			self.sendSocketNotification("GET_DEPARTURE_DATA", self.config);
		}, self.config.updateInterval);
	},

	// Override dom generator.
	getDom: function () {
		let wrapperTable = document.createElement("div");
		if (this.config.haltestelle === "") {
			wrapperTable.className = "dimmed light small";
			wrapperTable.innerHTML = "Please set value for 'Haltestelle'.";
			return wrapperTable;
		}

		if (!this.resultData.hasOwnProperty(this.config.haltestelle)) {
			wrapperTable.className = "dimmed light small";
			wrapperTable.innerHTML = "Loading data from MVG ...";
			return wrapperTable;
		}
		wrapperTable = document.createElement("table");
		wrapperTable.className = "small";
		wrapperTable.appendChild(this.resultData[this.config.haltestelle]);
		return wrapperTable;
	},

	getHtml: function (jsonObject) {
		let tbody = document.createElement("tbody");

		let visibleLines = 0;
		const interruptions = new Set();

		if (this.config.addDelay) {
			// add delay to departure time
			for (let i = 0; i < jsonObject.departures.length; i++) {
				let delay = parseInt(jsonObject.departures[i].delay);
				if (!isNaN(delay)) {
					jsonObject.departures[i].departureTime += delay * MS_PER_MINUTE;
				}
			}
			// sort by real departure time
			jsonObject.departures.sort(function(a,b) { return a.departureTime - b.departureTime; });
		}

		// calculate fade steps
		const fadeStart = this.config.maxEntries * this.config.fadePoint;
		const fadeSteps = this.config.maxEntries - fadeStart;

		for (let i = 0; i < jsonObject.departures.length; i++) {
			if (visibleLines >= this.config.maxEntries) {
				break;
			}
			// get one item from api result
			const apiResultItem = jsonObject.departures[i];
			// get transport type
			const transportType = apiResultItem.product.toLocaleLowerCase();

			// check if we should show data of this transport type
			if (!this.config.transportTypesToShow[transportType]
				|| this.config.ignoreStations.includes(apiResultItem.destination)
				|| this.checkToIgnoreOrIncludeLine(apiResultItem.label)
			) {
				continue;
			}

			// calculate row opacity
			let opacity = 1;
			if (this.config.fade && visibleLines >= fadeStart) {
				opacity = 1 - (visibleLines - fadeStart) / fadeSteps;
			}

			let row = document.createElement("tr");
			row.style.opacity = opacity;
			if (this.config.showInterruptions && this.isLineAffected(apiResultItem.label)) {
				row.className = "gray";
			} else {
				row.className = "normal";
			}

			let cell = document.createElement("td");
			let icon = document.createElement("span");
			icon.className = "icon";
			icon.style.opacity = this.config.iconOpacity;
			if (this.config.showLineColors) {
				// colorize with line color
				icon.style.color = "white";
				icon.style.backgroundColor = apiResultItem.lineBackgroundColor;
			}
			if (this.config.showIcons) {
				// add icon
				let logo = document.createElement("img");
				logo.src = this.data.path + "/resources/" + apiResultItem.product.toLocaleLowerCase() + ".svg";
				icon.appendChild(logo);
			}
			// add transport number
			let label = document.createElement("span");
			label.appendChild(document.createTextNode(apiResultItem.label));
			icon.appendChild(label);
			cell.appendChild(icon);
			row.appendChild(cell);

			// add last station aka direction
			cell = document.createElement("td")
			cell.className = "stationColumn";
			cell.appendChild(document.createTextNode(apiResultItem.destination));
			row.appendChild(cell);
			// check if user want's to see departure time
			this.showDepartureTime(apiResultItem.departureTime, row);
			// check if user want's to see walking time
			this.showWalkingTime(apiResultItem.departureTime, row);
			// check if user want's to see delay
			this.showDelay(apiResultItem.delay, row);

			// append row
			tbody.appendChild(row);
			visibleLines++;

			if (this.config.showInterruptionsDetails && this.isLineAffected(apiResultItem.label)) {
				let interruption = this.getInterruptionsDetails(apiResultItem.label);
				let colspan = row.childElementCount - 1;
				if (!interruptions.has(interruption)) {
					interruptions.add(interruption);
					row = document.createElement("tr");
					row.appendChild(document.createElement("td"));
					cell = document.createElement("td");
					cell.className = "empty";
					cell.colSpan = colspan;
					cell.appendChild(document.createTextNode(interruption));
					if (this.config.countInterruptionsAsItemShown) {
						if (this.config.fade && visibleLines >= fadeStart) {
							opacity = 1 - (visibleLines - fadeStart) / fadeSteps;
						}
						visibleLines++;
					}
					row.style.opacity = opacity;
					row.appendChild(cell);
					tbody.appendChild(row);
				}
			}
		}
		return tbody;
	},

	checkToIgnoreOrIncludeLine: function (lineName) {
		return this.config.lineFiltering !== undefined
		&& this.config.lineFiltering.active
		&& (this.config.lineFiltering.filterType.localeCompare("whitelist") === 0 ?
				!this.checkLineNumbersIncludes(lineName) : this.checkLineNumbersIncludes(lineName));
	},

	checkLineNumbersIncludes: function (lineName) {
		return (this.config.lineFiltering.lineNumbers.includes(lineName));
	},

	isLineAffected: function (lineName) {
		if (this.interruptionData.affectedLines != undefined) {
			for (let i = 0; i < this.interruptionData.affectedLines.line.length; i++) {
				if (this.interruptionData.affectedLines.line[i].line === lineName) {
					return true;
				}
			}
		}
		return false;
	},

	getInterruptionsDetails: function (lineName) {
		for (let i = 0; i < this.interruptionData.interruption.length; i++) {
			if (this.interruptionData.interruption[i].lines.line != null) {
				for (let j = 0; j < this.interruptionData.interruption[i].lines.line.length; j++) {
					if (this.interruptionData.interruption[i].lines.line[j].line === lineName) {
						return this.interruptionData.interruption[i].duration.text + " - " + this.interruptionData.interruption[i].title;
					}
				}
			}
		}
		return "";
	},

	showWalkingTime: function (departureTime, row) {
		if (this.config.showWalkingTime) {
			// add departure time
			let cell = document.createElement("td");
			const startWalkingTime = new Date(departureTime - this.config.timeToWalk * MS_PER_MINUTE);
			// check what kind of time user wants (absolute / relative)
			let text;
			if (this.config.trainDepartureTimeFormat === "absolute") {
				text = this.getAbsoluteTime(startWalkingTime);
			} else if (this.config.trainDepartureTimeFormat === "relative") {
				text = this.getRelativeTime(startWalkingTime);
			} else {
				text = "walkingTimeFormat config is wrong";
			}
			cell.appendChild(document.createTextNode(" / " + text));
			row.append(cell);
		}
	}
	,

	showDepartureTime: function (departureTime, row) {
		if (this.config.showTrainDepartureTime) {
			// add departure time
			let cell = document.createElement("td");
			cell.className = "timing";
			const departureDate = new Date(departureTime);
			// check what kind of time user wants (absolute / relative)
			let text;
			if (this.config.trainDepartureTimeFormat === "absolute") {
				text = this.getAbsoluteTime(departureDate);
			} else if (this.config.trainDepartureTimeFormat === "relative") {
				text = this.getRelativeTime(departureDate);
			} else {
				text = "trainDepartureTimeFormat config is wrong";
			}
			cell.appendChild(document.createTextNode(text));
			row.append(cell);
		}
	}
	,

	showDelay: function (delay, row) {
		if (this.config.showDelay) {
			// add delay
			let cell = document.createElement("td");
			cell.className = "delay";
			if (parseInt(delay) > 0) {
				cell.appendChild(document.createTextNode("+" + delay));
			}
			row.append(cell);
		}
	}
	,

	getAbsoluteTime: function (time) {
		let hoursStr = (time.getHours() < 10 ? "0" : "") + time.getHours();
		let minutesStr = (time.getMinutes() < 10 ? "0" : "") + time.getMinutes();

		return hoursStr + ":" + minutesStr;
	}
	,

	getRelativeTime: function (time) {
		const timingForStartWalking = Math.floor((time.getTime() - new Date().getTime()) / 1000 / 60);
		return (timingForStartWalking <= 0
			? this.translate("JETZT")
			: this.translate("IN") + " " + timingForStartWalking + " " + this.translate("MIN"));
	}
	,

	// Override getHeader method.
	getHeader: function () {
		if (this.config.haltestelle !== "" || this.config.haltestelleName !== "") {
			return (this.data.header ? this.data.header + ": " : "") +
				(this.config.haltestelleName === "" ? this.config.haltestelle : this.config.haltestelleName);
		}
		return "";
	}
	,

	socketNotificationReceived: function (notification, payload) {
		switch (notification) {
		case "UPDATE_DEPARTURE_INFO":
			this.resultData[payload.haltestelle] = this.getHtml(payload.transport);
			break;

		case "UPDATE_STATION":
			if (this.config.haltestelle === payload.haltestelle) {
				this.config.haltestelleId = payload.haltestelleId;
				this.config.haltestelleName = payload.haltestelleName;
			}
			this.getHeader();
			this.getData();
			break;

		case "UPDATE_INTERRUPTION_DATA":
			this.interruptionData = payload;
			break;

		default:
			Log.error();
		}
		this.updateDom();
	}
});
