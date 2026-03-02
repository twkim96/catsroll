#include <iostream>
#include <cmath>
#include <vector>
#include <stdint.h>

//I need some global variables for making this work
using namespace std; //this isn't a variable but it gets the code shorter
typedef unsigned int seet_t;
int numberRare = 0, numberSuperRare = 0, numberUber = 0, numberLegend = 0, superRareChance = 0, uberRareChance = 0, legendaryRareChance = 0;
vector<seet_t> testGetInt;
vector<vector<seet_t>> catList = {};

pair<seet_t, seet_t> seedIter(pair<seet_t, seet_t> start) {	//.first=seed .second=modulo
	auto seed = start.first, modulo = start.second;										//that's where the seed evolves
	seed ^= seed << 13;
	seed ^= seed >> 17;
	seed ^= seed << 15;
	pair<seet_t, seet_t> returnedPair(seed, seed % modulo);
	return returnedPair;
}

int rem2(int r, int y) {
	y = abs(y);
	if (r == 3) {
		return y % numberLegend;
	}
	else if (r == 2) {
		return y % numberUber;
	}
	else if (r == 1) {
		return y % numberSuperRare;
	}
	else {
		return y % numberRare;
	}
}

int getSlot(int rarity) { //we technically need the number of legends, but it's always 1
	if (rarity == 0)
		return numberRare;
	else if (rarity == 1)
		return numberSuperRare;
	else if (rarity == 2)
		return numberUber;
	else return numberLegend;
}

int rem1(int x) { //turns score into rarity
	x = abs(x);
	x = x % 10000;
	if (x >= legendaryRareChance) {
		return 3;
	}
	else if (x >= uberRareChance) {
		return 2;
	}
	else if (x >= superRareChance) {
		return 1;
	}
	else {
		return 0;
	}
}

pair<seet_t, seet_t> calculateSeedThread(seet_t begin, seet_t end) {
	pair <seet_t, seet_t> unit;
	int rarity;
	for (seet_t i = begin; i < end; i++) {
		unit.first = i;
		seet_t j = 0;
		auto currentCouple = unit;
		while (j < catList.size() + 1) {
			currentCouple.second = 10000;
			currentCouple = seedIter(currentCouple);
			rarity = rem1(currentCouple.second);
			currentCouple.second = getSlot(rarity);
			currentCouple = seedIter(currentCouple);
			if (rarity != catList.at(j).at(0)) { //if rarity == 4, it skips the current slot, it's a hole
				if (catList.at(j).at(0) < 4)
					break;
			}
			if (currentCouple.second != catList.at(j).at(1)) {
				if (catList.at(j).at(0) > 3)
					continue;
				else {
					if (j == 0) break;
					if ((rarity == catList.at(j - 1).at(0)) && (rarity == 0) && currentCouple.second == catList.at(j-1).at(1)) {
						int oldSlot = currentCouple.second;
						currentCouple = seedIter(pair<seet_t, seet_t>(currentCouple.first, numberRare - 1));
						if (currentCouple.second > oldSlot) currentCouple.second = (currentCouple.second + 1) % numberRare; //TODO implementation for collabs is missing
						if (currentCouple.second != catList.at(j).at(1)) break;
					}
					else break;
				}
			}
			if (j == catList.size() - 1) {
				return pair<seet_t, seet_t>(i, currentCouple.first);
			}
			j++;
		}
	}
	return pair<seet_t, seet_t>(0,0);
}

int main(int argc, char** argv)
{
	if (argc % 2 == 1 || argc < 9) //can't be correct if this is true
		return -1;
	numberRare = atoi(argv[6]);
	numberSuperRare = atoi(argv[7]);
	numberUber = atoi(argv[8]);
	numberLegend = atoi(argv[9]);
	legendaryRareChance = 10000 - atoi(argv[5]);
	uberRareChance = legendaryRareChance - atoi(argv[4]);
	superRareChance = uberRareChance - atoi(argv[3]);
	auto numberOfPull = (argc - 9) / 2;
	for (seet_t i = 0; i < numberOfPull; i++) { //getting the rolls, supports holes
		vector<seet_t>temp;
		temp.push_back(atoi(argv[10 + 2 * i])-2);	//rarity
		temp.push_back(atoi(argv[11 + 2 * i]));		//slotcode
		catList.push_back(temp);
	}

	auto result = calculateSeedThread(1, UINT32_MAX-2);

	if (result.first != 0)
		cout << result.first << endl << result.second << endl;

	return 0;
}


