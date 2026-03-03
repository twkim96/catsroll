# Battle Cats Rolls <https://bc.godfat.org/>

## How to install the Ruby server

The simplest and easiest way to install all dependencies including the
optional ones:

    gem install bundler
    bundle install

### Selective about optional dependencies

If you would like to avoid installing unnecessary dependencies:

    gem install bundler
    bundle config set without 'cache:test'
    bundle install

And you should pick a caching strategy by choosing one:

* Set up memcached and run `gem install dalli`
* Use LRU cache so run `gem install lru_redux`

### `sleepy_penguin` compile error on Mac

If you hit into a compile error looks like this while compiling
`sleepy_penguin` on Mac:

    kqueue.c:408:19: error: incompatible function pointer types passing

You can pass `-Wno-incompatible-function-pointer-types` to the C compiler to
ignore this error. You can do this by running:

    gem install sleepy_penguin -- --with-cflags=-Wno-incompatible-function-pointer-types

When you run `bundle install` it should reuse gems installed via `gem install`.
If it's not reusing the gems, see the next section about setting up Ruby
environment. If you prefer to do this via `bundle install`, you can pass the
flag by setting:

    bundle config build.sleepy_penguin --with-cflags=-Wno-incompatible-function-pointer-types

This will create a `.bundle/config` file remembering this flag and next time
when you run `bundle install` it'll pass it to `sleepy_penguin`.

### Setting up Ruby environment

I try not to be too prescriptive about how to set up Ruby environment because
I have some personal preference which I know it's not for everyone. However,
apparently there are many people who are not familiar with Ruby to set it up,
and they can use some help and instructions. Here are my recommendations:

* Install Ruby with your preferred package manager.
  * If you want to install a specific Ruby version which is not supported by
    the package manager you preferred, try
    [`ruby-install`](https://github.com/postmodern/ruby-install)
    * Note that you might also be able to install `ruby-install` by your
      preferred package manager.
* To avoid installing to system path, you can use `--user-install` for `gem`:
  * `gem install --user-install bundler`
  * Note that in this case you need to set up `PATH` to point to the `bin`
    path for the executable to be globally accessible. Check this document:
    [I installed gems with --user-install and their commands are not available](https://guides.rubygems.org/faqs/#i-installed-gems-with---user-install-and-their-commands-are-not-available)
* To tell `bundler` to install to the same path, you also need to configure it:
  * `bundle config set path ~/.gem`
  * This is sort of documented at:
    [Remembering Options](https://bundler.io/man/bundle-config.1.html#REMEMBERING-OPTIONS)
* Ruby finds gems in `GEM_HOME` environment variable. If gems cannot be found
  when running the server, you can debug via `gem env`, and set `GEM_HOME`
  accordingly if the default doesn't work for you.
* If you prefer to use `bundler` to control the paths for you, then you can
  also use `bundle exec COMMAND` where `COMMAND` is any scripts which
  eventually run a Ruby script like `bin/server`.

### Updating Ruby dependencies

Normally I update everything, not really pining the version at all because
it's pretty minimal and most versions are compatible and working. So I do:

    gem update
    gem cleanup

Every once in a while. However, if you prefer to pin the versions, or use
bundler to install and update, you can also run:

    bundle update
    gem cleanup

## How to build the VampireFlower seed seeker:

First install [clang](https://clang.llvm.org), then:

    ./Seeker/bin/build-VampireFlower.sh

This should build the seed seeker at: `Seeker/Seeker-VampireFlower`, which
will be used by the Ruby server.

## How to run the server locally:

    ./bin/server

## Production with memcached, nginx, varnish, systemd and socket activation:

### Set up memcached

Nothing special needed. Just install and run it:

    sudo systemctl enable memcached
    sudo systemctl start memcached

### Set up nginx

Take `config/nginx.conf` as an example to set up nginx, and start it with
systemd:

    sudo systemctl enable nginx
    sudo systemctl start nginx

### Set up varnish

Take `config/varnish.vcl` as an example to set up varnish, and start it with
systemd:

    sudo systemctl enable varnish
    sudo systemctl start varnish

Note that you might want to change the systemd service to bind it only to
`localhost` instead of `0.0.0.0`.

### Other various setup

Tweak the paths in `config/battlecatsrolls@.service` accordingly and run:

    sudo ./bin/install # Read the contents before you run it!

Note that this also:

* Set up a `bcat` user to run for the application server
* Set up Git config so auto-updater can work properly
* Set up sudoer so `bin/rsync-data` can work properly

### Read logs

Read the whole logs:

    ./bin/log

Watch the logs in realtime:

    ./bin/log -f

Read the last 2000 lines of logs:

    ./bin/log -e -n 2000

### Restart with zero down time

This will start a temporary server taking requests while shutting down
the old server. When the old server is properly restarted, the temporary
server will be shut down.

    sudo ./bin/restart-zero-down

### Forceful restart

Sometimes the application server is broken anyway, we want to restart
immediately. In this case you can run this to force it to restart now.

    sudo ./bin/hard-restart

### Uninstallation

    sudo ./bin/uninstall # Read the contents before you run it!

## Environment variables defined in `.env` file

In order to build data from the event data, some keys and secrets must be
set to access the data. It's intended that this repository does not share
any of the keys and secrets. If you would like to build data, or access the
latest event data, you have to figure out the keys and secrets on your own.

If you only want to run the server locally, the data is already built and
populated in the repository. You can just run it without any keys or secrets.
You can create an empty `.env` file or ignore it. Showing tracks does not
require any of the keys or secrets.

## How to build data:

Build everything:

    env (cat .env) ruby bin/build.rb

Build BCEN data:

    env (cat .env) ruby bin/build.rb en

Build BCTW data:

    env (cat .env) ruby bin/build.rb tw

Build BCJP data:

    env (cat .env) ruby bin/build.rb jp

Build BCKR data:

    env (cat .env) ruby bin/build.rb kr

## Thanks:

### Tracking discovery for 7.2+

* [Seed Tracking TBC 7.3 Public Release](https://old.reddit.com/r/BattleCatsCheats/comments/9jvdcg/seed_tracking_tbc_73_public_release/)

### The spreadsheet 2.0

* [[Cheating] Rare Ticket Forecasting Spreadsheet v2.0](https://old.reddit.com/r/battlecats/comments/8mhun4/cheating_rare_ticket_forecasting_spreadsheet_v20/)

### Finding my seed and providing information

* [[Cheating] Seed calculation here!](https://old.reddit.com/r/battlecats/comments/8cbs2i/cheating_seed_calculation_here/e0r8l9v/)

### How it works

* [[Tutorial] [Cheating] (Almost) Everything you could possibly want to know about the gacha system in v5.10.](https://old.reddit.com/r/battlecats/comments/64geym/tutorial_cheating_almost_everything_you_could/)

### Decrypting the app data

* [Is there anyone able to access BC files? Your help is needed!](https://old.reddit.com/r/battlecats/comments/41e4l1/is_there_anyone_able_to_access_bc_files_your_help/cz3npr2)
* [Unit upgrade cost spreadsheet?](https://old.reddit.com/r/battlecats/comments/3em0bw/unit_upgrade_cost_spreadsheet/cthqo3f)
* [FX File Explorer](https://play.google.com/store/apps/details?id=nextapp.fx)

### Event data

* [[BCEN] New Event Data - Last Half of October 2017](https://old.reddit.com/r/battlecats/comments/75w399/bcen_new_event_data_last_half_of_october_2017/dostwfb)
* [[BCEN] New Event Data - First Half of July 2018](https://old.reddit.com/r/battlecats/comments/8vikts/bcen_new_event_data_first_half_of_july_2018/e1sc33v/)
* [[Cheating] Rare Ticket Forecasting - Seed Request Thread](https://www.reddit.com/r/battlecats/comments/7t2dlb/cheating_rare_ticket_forecasting_seed_request/dtb3q0w/)
* [How to retrieve and decipher Battle Cats event data](https://old.reddit.com/r/battlecats/comments/3tf03s/how_to_retrieve_and_decipher_battle_cats_event/)

### Other references

* [[Tutorial] [Cheating] (Almost) Rare Ticket draw Forcasting Spreadsheet](https://www.reddit.com/r/battlecats/comments/7llv80/tutorial_cheating_almost_rare_ticket_draw/)
* [[Cheating] Seed finder and draw strategy manager](https://old.reddit.com/r/battlecats/comments/8cbuyw/cheating_seed_finder_and_draw_strategy_manager/)
* [[BCEN] All cat data for Battle Cats 7.2](https://old.reddit.com/r/battlecats/comments/96ogif/bcen_all_cat_data_for_battle_cats_72/)
  * [unit&lt;num&gt;.csv columns](https://pastebin.com/JrCTPnUV)

### Helpful relevant source code

* [Battle Cats Ultimate](https://github.com/battlecatsultimate/BCU_java_util_common)
* [Normal gacha tracking](https://github.com/ampuri/bc-normal-seed-tracking)
  * [Normal gacha data](https://github.com/ampuri/bc-normal-seed-tracking/blob/master/src/utils/bannerData.tsx)
* [The Battle Cats Modding Library](https://codeberg.org/fieryhenry/tbcml)
  * [Download server data](https://codeberg.org/fieryhenry/tbcml/src/branch/master/src/tbcml/server_handler.py)

## CONTRIBUTORS:

* clam
* fieryhenry
* forgothowtoreddid (@reddid)
* Lin Jen-Shin (@godfat)
* MandarinSmell
* ThanksFëanor
* @VampireFlower
* yuki2nd
* 占庭 盧 (@lzt00275)

## LICENSE:

Apache License 2.0

Copyright (c) 2018-2025, Lin Jen-Shin (godfat)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
